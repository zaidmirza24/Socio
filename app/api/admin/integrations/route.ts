import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { ApifyClient } from "apify-client";
import { requireAdmin } from "@/lib/supabase/require-admin";
import { parseApifyError, getApifyClientAsync } from "@/lib/apify/client";
import { detectCredentials, pickInstagramTask, type TaskSummary } from "@/lib/services/smart-setup";
import {
  getIntegrationStatus,
  getSecret,
  deleteSecret,
  saveStoredApifyConfig,
  setSecret,
} from "@/lib/services/integrations";
import { PLATFORM_CONFIG } from "@/lib/config/platforms";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("smart-setup"), text: z.string().min(1).max(20_000) }),
  z.object({ action: z.literal("select-task"), taskId: z.string().min(3).max(64) }),
  z.object({
    action: z.literal("save-actors"),
    platform: z.enum(["instagram", "facebook", "x"]),
    discovery: z.string().min(3).max(64).optional(),
    refresh: z.string().min(3).max(64).optional(),
  }),
  z.object({ action: z.literal("remove-secret"), name: z.enum(["apify_api_token"]) }),
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
