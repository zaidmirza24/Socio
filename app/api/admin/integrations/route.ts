import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApifyClient } from "apify-client";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { parseApifyError, getApifyClientAsync } from "@/lib/apify/client";
import { detectCredentials, pickInstagramTask, type TaskSummary } from "@/lib/services/smart-setup";
import { generateSecret } from "@/lib/services/crypto";
import {
  getApifyConfig,
  getIntegrationStatus,
  getSecret,
  getWebhookUrl,
  deleteSecret,
  saveStoredApifyConfig,
  setSecret,
} from "@/lib/services/integrations";
import { PLATFORM_CONFIG } from "@/lib/config/platforms";

const WEBHOOK_EVENTS = [
  "ACTOR.RUN.SUCCEEDED",
  "ACTOR.RUN.FAILED",
  "ACTOR.RUN.TIMED_OUT",
  "ACTOR.RUN.ABORTED",
] as const;

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("smart-setup"), text: z.string().min(1).max(20_000) }),
  z.object({ action: z.literal("select-task"), taskId: z.string().min(3).max(64) }),
  z.object({
    action: z.literal("save-actors"),
    platform: z.enum(["instagram", "facebook", "x"]),
    discovery: z.string().min(3).max(64).optional(),
    refresh: z.string().min(3).max(64).optional(),
  }),
  z.object({ action: z.literal("generate-webhook-secret") }),
  z.object({ action: z.literal("register-webhook"), appUrl: z.string().url().optional() }),
  z.object({ action: z.literal("remove-secret"), name: z.enum(["apify_api_token", "apify_webhook_secret"]) }),
]);

/** GET /api/admin/integrations - masked status only. Never returns a raw secret. */
export async function GET() {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ status: await getIntegrationStatus() });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load integrations" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin();
  if (!guard.ok) return guard.response;

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.format() }, { status: 400 });
  }
  const body = parsed.data;

  try {
    switch (body.action) {
      // ---------------------------------------------------------------------
      // Paste anything → detect → validate → save → auto-pick the Instagram task
      // ---------------------------------------------------------------------
      case "smart-setup": {
        const detected = detectCredentials(body.text);
        const existing = await getSecret("apify_api_token");
        const token = detected.apifyToken ?? existing.value;

        if (!token) {
          return NextResponse.json(
            {
              error:
                "I couldn't find an Apify API token in what you pasted. A token looks like apify_api_xxxxxxxx… " +
                "- copy it from https://console.apify.com/account/integrations",
              recognised: detected.recognised,
            },
            { status: 400 }
          );
        }

        // Validate BEFORE saving anything
        const client = new ApifyClient({ token });
        let username: string;
        try {
          const me = await client.user().get();
          username = me.username;
        } catch (err: unknown) {
          const { message, statusCode } = parseApifyError(err);
          return NextResponse.json(
            { error: `Apify rejected this token - nothing was saved. ${message}`, recognised: detected.recognised },
            { status: statusCode === 401 ? 400 : statusCode }
          );
        }

        const actions: string[] = [];
        const warnings: string[] = [];

        if (detected.apifyToken) {
          await setSecret("apify_api_token", detected.apifyToken, guard.userId);
          actions.push("Saved Apify token (encrypted)");
        }
        if (detected.webhookSecret) {
          await setSecret("apify_webhook_secret", detected.webhookSecret, guard.userId);
          actions.push("Saved webhook secret (encrypted)");
        }

        // Discover the account's tasks and choose the Instagram one
        let tasks: TaskSummary[] = [];
        try {
          const list = await client.tasks().list({ limit: 100 });
          tasks = list.items.map((t) => ({ id: t.id, actId: t.actId, name: t.name, title: t.title }));
        } catch {
          warnings.push("Token is valid but I couldn't list your Apify tasks.");
        }

        let chosen: TaskSummary | null = null;
        if (detected.taskId) {
          chosen = tasks.find((t) => t.id === detected.taskId) ?? null;
          if (!chosen) warnings.push(`Task ${detected.taskId} was not found in this Apify account.`);
        }
        const { picked, candidates } = pickInstagramTask(tasks, PLATFORM_CONFIG.instagram.discoveryActorId);
        if (!chosen) chosen = picked;

        if (chosen) {
          await saveStoredApifyConfig({ task_id: chosen.id }, guard.userId);
          actions.push(`Selected task “${chosen.title || chosen.name}”`);
        } else if (candidates.length > 1) {
          warnings.push("Several Instagram tasks found - pick one below.");
        } else if (tasks.length === 0) {
          warnings.push(
            "No saved Apify tasks found. That's fine: the app will call the Instagram actor directly. " +
              "Create a Task in Apify if you want the daily Schedule to run with fixed settings."
          );
        }

        if (!chosen && detected.actorIds.length === 1) {
          await saveStoredApifyConfig(
            { actors: { instagram: { discovery: detected.actorIds[0], refresh: detected.actorIds[0] } } },
            guard.userId
          );
          actions.push("Saved Instagram actor from pasted link");
        }

        return NextResponse.json({
          success: true,
          username,
          recognised: detected.recognised,
          actions,
          warnings,
          candidates: candidates.length > 1 ? candidates : [],
          status: await getIntegrationStatus(),
        });
      }

      case "select-task": {
        const client = await getApifyClientAsync();
        const task = await client.task(body.taskId).get();
        if (!task) return NextResponse.json({ error: "That task does not exist in your Apify account." }, { status: 404 });
        await saveStoredApifyConfig({ task_id: task.id }, guard.userId);
        return NextResponse.json({ success: true, status: await getIntegrationStatus() });
      }

      case "save-actors": {
        const actors = {
          [body.platform]: {
            ...(body.discovery ? { discovery: body.discovery } : {}),
            ...(body.refresh ? { refresh: body.refresh } : {}),
          },
        };
        await saveStoredApifyConfig({ actors }, guard.userId);
        return NextResponse.json({ success: true, status: await getIntegrationStatus() });
      }

      case "generate-webhook-secret": {
        const secret = generateSecret();
        await setSecret("apify_webhook_secret", secret, guard.userId);
        // Returned ONCE so the admin can copy it for a manual Apify setup. "Register webhook" needs no copying.
        return NextResponse.json({ success: true, revealedOnce: secret, status: await getIntegrationStatus() });
      }

      case "register-webhook": {
        const webhookUrl = getWebhookUrl(body.appUrl);
        if (!webhookUrl) {
          return NextResponse.json(
            { error: "Set NEXT_PUBLIC_APP_URL to your deployed (Vercel) URL, or pass it in the request." },
            { status: 400 }
          );
        }
        const host = new URL(webhookUrl).hostname;
        if (host === "localhost" || host === "127.0.0.1" || host.endsWith(".local")) {
          return NextResponse.json(
            { error: "Apify cannot reach localhost. Deploy to Vercel first, then register the webhook with your public URL." },
            { status: 400 }
          );
        }

        let secret = (await getSecret("apify_webhook_secret")).value;
        if (!secret) {
          secret = generateSecret();
          await setSecret("apify_webhook_secret", secret, guard.userId);
        }

        const client = await getApifyClientAsync();
        const config = await getApifyConfig();

        // Conditions: the scheduled task + every actor the app can start (so refresh runs are ingested too)
        const conditions: Array<{ key: string; condition: { actorTaskId: string } | { actorId: string } }> = [];
        if (config.taskId) conditions.push({ key: `task:${config.taskId}`, condition: { actorTaskId: config.taskId } });
        const actorIds = new Set<string>();
        for (const p of Object.values(config.actors)) {
          actorIds.add(p.discovery);
          actorIds.add(p.refresh);
        }
        for (const id of actorIds) conditions.push({ key: `actor:${id}`, condition: { actorId: id } });

        const existing = await client.webhooks().list({ limit: 1000 });
        const headersTemplate = JSON.stringify({ "x-apify-webhook-secret": secret });
        let created = 0;
        let updated = 0;

        for (const c of conditions) {
          const match = existing.items.find((w) => {
            const cond = w.condition as unknown as Record<string, string | undefined>;
            return (
              w.requestUrl === webhookUrl &&
              (("actorTaskId" in c.condition && cond.actorTaskId === c.condition.actorTaskId) ||
                ("actorId" in c.condition && cond.actorId === c.condition.actorId && !cond.actorTaskId))
            );
          });
          if (match) {
            await client.webhook(match.id).update({ eventTypes: [...WEBHOOK_EVENTS], headersTemplate });
            updated++;
          } else {
            await client.webhooks().create({
              eventTypes: [...WEBHOOK_EVENTS],
              condition: c.condition,
              requestUrl: webhookUrl,
              headersTemplate,
              description: "Socio ingestion webhook (managed from Settings)",
            });
            created++;
          }
        }

        return NextResponse.json({
          success: true,
          webhookUrl,
          created,
          updated,
          message: `Webhook ready: ${created} created, ${updated} refreshed (${webhookUrl}).`,
          status: await getIntegrationStatus(),
        });
      }

      case "remove-secret": {
        await deleteSecret(body.name);
        return NextResponse.json({ success: true, status: await getIntegrationStatus() });
      }
    }
  } catch (err: unknown) {
    const { message, statusCode } = parseApifyError(err);
    return NextResponse.json({ error: message }, { status: statusCode });
  }
}
