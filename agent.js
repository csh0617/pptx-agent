/**
 * agent.js
 * Claude API agent loop with bash tool execution.
 * Claude writes pptxgenjs code â executes it â returns the .pptx file path.
 */

const Anthropic = require("@anthropic-ai/sdk");
const { exec } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const { SYSTEM_PROMPT } = require("./system-prompt");

const execAsync = promisify(exec);
const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// âââ Tool definition ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
const TOOLS = [
  {
    name: "bash",
    description:
      "Execute a bash command. Use this to write files, run Node.js scripts, " +
      "install packages, and manage the PPTX generation process. " +
      "Each call is independent â use absolute paths.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash command to execute" },
      },
      required: ["command"],
    },
  },
];

// âââ Bash executor ââââââââââââââââââââââââââââââââââââââââââââââââââââââââââââ
async function runBash(command, workDir) {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: workDir,
      timeout: 120_000,          // 2 min max per command
      maxBuffer: 10 * 1024 * 1024,
    });
    const out = stdout.trim();
    const err = stderr.trim();
    return out + (err ? `\nSTDERR: ${err}` : "");
  } catch (e) {
    return `ERROR: ${e.message}\n${e.stdout || ""}\n${e.stderr || ""}`.trim();
  }
}

// âââ Main agent function ââââââââââââââââââââââââââââââââââââââââââââââââââââââ
/**
 * @param {string} topic      - Presentation topic (e.g. "ë¯¸ëì°¨ ì¬ë¼ì´ë 10ì¥")
 * @param {string} workDir    - Temp directory for this job
 * @param {string} outputPath - Where to save the final .pptx
 * @returns {Promise<string>} - Path to the generated .pptx file
 */
async function generatePptx(topic, workDir, outputPath) {
  // Ensure workDir exists and has pptxgenjs installed
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
  const MAX_ITERATIONS = 12;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    const response = await client.messages.create({
      model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
    });

    // Add assistant turn
    messages.push({ role: "assistant", content: response.content });

    // Done â no more tool calls
    if (response.stop_reason === "end_turn") break;

    // Execute tool calls
    if (response.stop_reason === "tool_use") {
      const toolResults = [];

      for (const block of response.content) {
        if (block.type !== "tool_use") continue;

        console.log(`[agent] bash: ${block.input.command.slice(0, 80)}...`);
        const result = await runBash(block.input.command, workDir);
        console.log(`[agent] result: ${result.slice(0, 120)}`);

        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: result,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }
  }

  // Verify output exists
  if (!fs.existsSync(outputPath)) {
    throw new Error(
      `Agent finished but ${outputPath} was not created. Check agent logs.`
    );
  }

  return outputPath;
}

module.exports = { generatePptx };
