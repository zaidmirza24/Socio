import readline from "node:readline/promises";

/**
 * Guard for scripts that wipe data. They run with the service-role key against whatever
 * .env.local points at, which is normally the SHARED campaign database.
 *
 * Proceeds only if `--yes` is passed AND the operator types the project's host name, or if
 * CONFIRM_DESTRUCTIVE equals that host name (for non-interactive use).
 */
export async function confirmDestructive(action, supabaseUrl) {
  const host = new URL(supabaseUrl).host;
  const projectRef = host.split(".")[0];

  console.warn(`\n⚠  ${action}`);
  console.warn(`   Target Supabase project: ${host}`);
  console.warn("   This permanently deletes data for everyone using this project.\n");

  if (!process.argv.includes("--yes")) {
    console.error("Refusing to run without --yes. Re-run with:  npm run <script> -- --yes");
    process.exit(1);
  }

  if (process.env.CONFIRM_DESTRUCTIVE === projectRef) return;

  if (!process.stdin.isTTY) {
    console.error(`Non-interactive shell: set CONFIRM_DESTRUCTIVE=${projectRef} to confirm.`);
    process.exit(1);
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = (await rl.question(`Type the project ref "${projectRef}" to continue: `)).trim();
  rl.close();
  if (answer !== projectRef) {
    console.error("Confirmation did not match. Nothing was changed.");
    process.exit(1);
  }
}
