/**
 * Ralph Wiggum Hook for AiderDesk
 * 
 * Enables PRD-driven autonomous AI coding workflow with naive persistence.
 * Only activates when user starts prompt with "ask ralph to" (case insensitive).
 * 
 * Features:
 * - Tracks progress via .ralph/progress.md
 * - Injects guardrails from .ralph/guardrails.md
 * - Warns at 70% token usage
 * - Enforces feedback loops before commits
 */

"use strict";

const fs = require("fs");
const path = require("path");

/**
 * Check if prompt starts with "ask ralph to" (case insensitive)
 * @param {string} prompt - The user prompt
 * @returns {boolean} True if Ralph Wiggum mode should be activated
 */
function isRalphPrompt(prompt) {
  const trimmed = prompt.trim();
  const pattern = /^ask ralph to\s+/i;
  return pattern.test(trimmed);
}

/**
 * Ensure .ralph directory exists with required files
 * @param {string} projectDir - Project directory path
 * @returns {object} Paths to ralph files
 */
function ensureRalphDirectory(projectDir) {
  const ralphDir = path.join(projectDir, ".ralph");
  const progressPath = path.join(ralphDir, "progress.md");
  const guardrailsPath = path.join(ralphDir, "guardrails.md");
  const activityPath = path.join(ralphDir, "activity.log");

  // Create .ralph directory
  if (!fs.existsSync(ralphDir)) {
    fs.mkdirSync(ralphDir, { recursive: true });
  }

  // Initialize progress.md
  if (!fs.existsSync(progressPath)) {
    fs.writeFileSync(progressPath, "# Progress\n\nNo items completed yet.\n");
  }

  // Initialize guardrails.md
  if (!fs.existsSync(guardrailsPath)) {
    fs.writeFileSync(guardrailsPath, "# Guardrails\n\nNo guardrails defined yet.\n");
  }

  // Initialize activity.log
  if (!fs.existsSync(activityPath)) {
    fs.writeFileSync(activityPath, "");
  }

  return { ralphDir, progressPath, guardrailsPath, activityPath };
}

/**
 * Read guardrails from file
 * @param {string} guardrailsPath - Path to guardrails.md
 * @returns {string} Guardrails content
 */
function readGuardrails(guardrailsPath) {
  if (fs.existsSync(guardrailsPath)) {
    const content = fs.readFileSync(guardrailsPath, "utf8");
    if (!content.includes("No guardrails defined yet")) {
      return content;
    }
  }
  return null;
}

/**
 * Extract task from Ralph prompt
 * @param {string} prompt - The user prompt
 * @returns {string} The actual task description
 */
function extractTask(prompt) {
  return prompt.replace(/^ask ralph to\s+/i, "").trim();
}

/**
 * Log activity to activity.log
 * @param {string} activityPath - Path to activity.log
 * @param {string} message - Activity message
 */
function logActivity(activityPath, message) {
  const timestamp = new Date().toISOString();
  const logEntry = `[${timestamp}] ${message}\n`;
  fs.appendFileSync(activityPath, logEntry);
}

module.exports = {
  /**
   * Triggered when a prompt is submitted.
   * Activates Ralph Wiggum mode if prompt starts with "ask ralph to".
   * 
   * @param {object} event - The prompt submitted event
   * @param {object} event.prompt - The user's original prompt
   * @param {object} context - The AiderDesk context object
   * @returns {object|undefined} Modified prompt or undefined
   */
  onPromptSubmitted: async (event, context) => {
    const originalPrompt = event.prompt;

    // Check if this is a Ralph Wiggum prompt
    if (!isRalphPrompt(originalPrompt)) {
      return undefined; // Not a Ralph prompt, let other hooks handle it
    }

    // Ralph Wiggum mode activated! 🎉
    const task = extractTask(originalPrompt);
    const projectDir = context.projectDir;
    const { progressPath, guardrailsPath, activityPath } = ensureRalphDirectory(projectDir);

    // Log activation
    logActivity(activityPath, `Activated for task: ${task}`);

    // Notify user
    context.addInfoMessage("🎯 Ralph Wiggum mode ACTIVATED");
    context.addInfoMessage(`📝 Task: ${task}`);
    context.addLoadingMessage("🛡️ Loading guardrails...");

    // Read existing guardrails
    const existingGuardrails = readGuardrails(guardrailsPath);

    // Build modified prompt with Ralph Wiggum context
    let modifiedPrompt = originalPrompt;

    if (existingGuardrails) {
      context.addSuccessMessage("✅ Guardrails loaded from previous iterations");
      modifiedPrompt += `\n\n## 🚨 CRITICAL: PREVIOUS ITERATION GUARDRAILS (MUST FOLLOW)\n${existingGuardrails}\n`;
    } else {
      context.addInfoMessage("📭 No existing guardrails found");
    }

    // Count unchecked items in progress for user feedback
    if (fs.existsSync(progressPath)) {
      const progress = fs.readFileSync(progressPath, "utf8");
      const uncheckedCount = (progress.match(/\[ \]/g) || []).length;
      const checkedCount = (progress.match(/\[\x\]/g) || []).length;

      if (uncheckedCount > 0 || checkedCount > 0) {
        context.addInfoMessage(`📊 Progress: ${checkedCount} completed, ${uncheckedCount} remaining`);
      }
    }

    // Add token warning instruction
    modifiedPrompt += `\n\n## ⚠️ TOKEN AWARENESS\nIf you receive a signal that token usage exceeds 70%, wrap up your current work and prepare for context rotation.\n`;

    // Log that we're returning the modified prompt
    logActivity(activityPath, "Injected guardrails into prompt");

    return { prompt: modifiedPrompt };
  },

  /**
   * Triggered when the agent starts processing a prompt.
   * Warns if tokens are approaching rotation threshold.
   * 
   * @param {object} event - The agent started event
   * @param {object} event.prompt - The prompt being processed
   * @param {object} context - The AiderDesk context object
   * @returns {undefined}
   */
  onAgentStarted: async (event, context) => {
    // Check if this is a Ralph prompt (we can check if .ralph was recently touched)
    const ralphDir = path.join(context.projectDir, ".ralph");

    if (fs.existsSync(ralphDir)) {
      // Check token usage
      const tokenInfo = context.getTokenUsage?.() || { percent: 0 };

      if (tokenInfo.percent > 80) {
        context.addErrorMessage("🚨 CRITICAL: Token usage exceeds 80% - context rotation recommended");
        logActivity(path.join(ralphDir, "activity.log"), `Token warning: ${tokenInfo.percent}%`);
      } else if (tokenInfo.percent > 70) {
        context.addWarningMessage(`⚠️ Token usage at ${tokenInfo.percent}% - consider wrapping up`);
      } else {
        context.addInfoMessage(`✅ Token usage healthy at ${tokenInfo.percent}%`);
      }
    }
  },

  /**
   * Triggered when a tool finishes execution.
   * Monitors feedback loops and adds guardrails on failure.
   * 
   * @param {object} event - The tool finished event
   * @param {object} event.toolName - Name of the tool
   * @param {object} event.args - Tool arguments
   * @param {object} event.result - Tool result
   * @param {object} context - The AiderDesk context object
   * @returns {undefined}
   */
  onToolFinished: async (event, context) => {
    const toolName = event.toolName;
    const args = event.args || {};
    const result = event.result;

    // Only process if we have a result
    if (!result) {
      return;
    }

    // Check if this is a feedback loop command
    const feedbackCommands = ["npm run test", "npm run lint", "npm run typecheck", "npm test", "npm lint", "npx tsc", "yarn test", "yarn lint"];
    const command = args.command || "";

    const isFeedbackLoop = feedbackCommands.some((cmd) => command.includes(cmd));

    if (!isFeedbackLoop) {
      return;
    }

    // Check for failure indicators in result
    const resultStr = JSON.stringify(result);
    const hasError = resultStr.includes('"error"') ||
                     resultStr.toLowerCase().includes("error") ||
                     resultStr.toLowerCase().includes("failed") ||
                     resultStr.toLowerCase().includes("failure") ||
                     resultStr.toLowerCase().includes("✖") ||
                     resultStr.toLowerCase().includes("✗");

    if (hasError) {
      const ralphDir = path.join(context.projectDir, ".ralph");
      const guardrailsPath = path.join(ralphDir, "guardrails.md");
      const activityPath = path.join(ralphDir, "activity.log");

      context.addErrorMessage(`❌ Feedback loop failed: ${toolName}`);

      // Extract useful error info for guardrail (simplified)
      const errorContext = command.includes("test")
        ? "test execution failed"
        : command.includes("lint")
        ? "linting check failed"
        : "type check failed";

      // Add guardrail to prevent recurrence
      const newGuardrail = `\n### Sign: Feedback loop failure - ${toolName}
- **Trigger**: Running \`${command}\`
- **Instruction**: Ensure all feedback loops pass before claiming completion
- **Context**: ${errorContext}
`;

      fs.appendFileSync(guardrailsPath, newGuardrail, "utf8");
      context.addWarningMessage("🛡️ Guardrail added to prevent this failure in future iterations");
      logActivity(activityPath, `Added guardrail: ${toolName} failed`);
    }
  },

  /**
   * Triggered when agent finishes processing.
   * Updates progress and provides summary.
   * 
   * @param {object} event - The agent finished event
   * @param {object} event.resultMessages - Agent result messages
   * @param {object} context - The AiderDesk context object
   * @returns {undefined}
   */
  onAgentFinished: async (event, context) => {
    const ralphDir = path.join(context.projectDir, ".ralph");

    if (!fs.existsSync(ralphDir)) {
      return; // Not a Ralph session
    }

    const activityPath = path.join(ralphDir, "activity.log");
    const progressPath = path.join(ralphDir, "progress.md");

    // Check progress file for completion status
    if (fs.existsSync(progressPath)) {
      const progress = fs.readFileSync(progressPath, "utf8");
      const uncheckedCount = (progress.match(/\[ \]/g) || []).length;
      const checkedCount = (progress.match(/\[\x\]/g) || []).length;

      if (uncheckedCount === 0 && checkedCount > 0) {
        context.addSuccessMessage("🎉 ALL PRD ITEMS COMPLETED!");
        logActivity(activityPath, "Session complete - all items finished");
      } else if (uncheckedCount > 0) {
        context.addInfoMessage(`📊 Session complete: ${checkedCount}/${checkedCount + uncheckedCount} items done`);
        logActivity(activityPath, `Session partial: ${checkedCount} completed, ${uncheckedCount} remaining`);
      }
    }

    context.addInfoMessage("💾 State saved to .ralph/ directory");
    context.addInfoMessage("🔄 New iteration will resume from where this one left off");
  },

  /**
   * Triggered when commit approval is requested.
   * Warns user to ensure feedback loops passed.
   * 
   * @param {object} event - The handle approval event
   * @param {object} event.key - Approval key (e.g., "commit")
   * @param {object} context - The AiderDesk context object
   * @returns {boolean|undefined} True to auto-approve, undefined for default
   */
  onHandleApproval: async (event, context) => {
    if (event.key !== "commit") {
      return undefined;
    }

    // This is a commit request - warn about feedback loops
    const ralphDir = path.join(context.projectDir, ".ralph");

    if (!fs.existsSync(ralphDir)) {
      return undefined; // Not a Ralph session
    }

    context.addWarningMessage("⚠️ RALPH MODE: Ensure all feedback loops (test, lint, typecheck) passed before committing");
    context.addInfoMessage("💡 Review .ralph/guardrails.md for lessons from previous iterations");

    // Auto-approve with warning
    return true;
  }
};
