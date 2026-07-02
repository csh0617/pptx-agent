/**
 * agent.js
 * Claude API agent loop with bash tool execution.
 * Claude writes pptxgenjs code → executes it → returns the .pptx file path.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const { SYSTEM_PROMPT } = require("./system-prompt");

const execAsync = promisify(exec);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Tool definition ────────────────────────────────────────────────
const TOOLS = [
  {
    name: "bash",
    description:
      "Execute a bash command. Use this to write files, run Node.js scripts, " +
      "install packages, and manage the PPTX generation process. " +
      "Each call is independent — use absolute paths.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to execute" },
      },
      required: ["command"],
    },
  },
];

// ─── Bash executor ────────────────────────────────────────────
async function runBash(command, workDir) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    });
    const out = stdout.trim();
    const err = stderr.trim();
    return out + (err ? `\nSTDERR: ${err}` : "");
  } catch (e) {
    return `ERROR: ${e.message}\n${e.stdout || ""}\n${e.stderr || ""}`.trim();
  }
}

// ─── Main agent function ──────────────────────────────────────────
/**
 * @param {string} topic      - Presentation topic
 * @param {string} workDir    - Temp directory for this job
 * @param {string} outputPath - Where to save the final .pptx
 * @returns {Promise<string>} - Path to the generated .pptx file
 */
async function generatePptx(topic, workDir, outputPath) {
  fs.mkdirSync(workDir, { recursive: true });
  await execAsync("npm init -y && npm install pptxgenjs", { cwd: workDir });

  const userMessage =
    `Generate a high-quality PowerPoint presentation about: ${topic}\n\n` +
    `Requirements:\n` +
    `- At least 10 slides\n` +
    `- Professional, visually rich design (visual element on every slide)\n` +
    `- Korean language content\n` +
    `- pptxgenjs is already installed in: ${workDir}\n` +
    `- Save the final file to: ${outputPath}\n\n` +
    `Start by writing the complete pptxgenjs script to ${workDir}/create.js, then run it.`;

  const messages = [{ role: "user", content: userMessage }];
  const MAX_ITERATIONS = 15;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    console.log(`[agent] iteration ${i + 1}/${MAX_ITERATIONS}`);

    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    console.log(`[agent] stop_reason: ${response.stop_reason}`);

    // Add assistant turn FIRST
    messages.push({ role: "assistant", content: response.content });

    // Find all tool_use blocks (don't rely solely on stop_reason)
    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    // If no tool calls, agent is done
    if (toolUseBlocks.length === 0) {
      console.log("[agent] No tool_use blocks — finishing.");
      break;
    }

    // CRITICAL: Every tool_use block MUST get a tool_result in the next user message.
    // Missing even one causes Claude API to return 400.
    const toolResults = [];

    for (const block of toolUseBlocks) {
      let result;
      try {
        const command = block.input?.command;
        if (!command) {
          result = "ERROR: tool_use block has no 'command' field";
          console.warn(`[agent] block ${block.id} missing command`);
        } else {
          console.log(`[agent] bash [${block.id.slice(-6)}]: ${command.slice(0, 100)}`);
          result = await runBash(command, workDir);
          console.log(`[agent] result: ${result.slice(0, 200)}`);
        }
      } catch (err) {
        result = `ERROR: ${err.message}`;
        console.error(`[agent] Exception for block ${block.id}:`, err.message);
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result || "(no output)",
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Agent finished but ${outputPath} was not created.`);
  }

  return outputPath;
}

module.exports = { generatePptx };
