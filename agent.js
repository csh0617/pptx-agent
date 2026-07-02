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

async function generatePptx(topic, workDir, outputPath) {
  fs.mkdirSync(workDir, { recursive: true });
  await execAsync("npm init -y && npm install pptxgenjs", { cwd: workDir });

  const scriptTemplate = `const OUTPUT_PATH = '${outputPath}';
const pptxgen = require('pptxgenjs');

(async () => {
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';

  // ===== ADD YOUR 10+ SLIDES HERE =====
  // Every slide needs a visual element (shapes, charts, stat callouts).
  // Korean language content throughout.
  // COLOR RULE: never use "#" prefix. 6-char hex only: e.g. color: "FF0000"

  // ===== END SLIDES =====

  await pres.writeFile({ fileName: OUTPUT_PATH });
  console.log('SAVED:' + OUTPUT_PATH);
})().catch(err => {
  console.error('SCRIPT_ERROR:', err.stack || err.message);
  process.exit(1);
});`;

  const userMessage =
    `Generate a high-quality PowerPoint presentation about: ${topic}\n\n` +
    `CRITICAL INSTRUCTIONS:\n` +
    `1. Write the script to ${workDir}/create.js using EXACTLY this structure:\n\n` +
    scriptTemplate + `\n\n` +
    `2. Fill in 10+ slides inside the "ADD YOUR 10+ SLIDES HERE" section.\n` +
    `3. Run it: node ${workDir}/create.js\n` +
    `4. Check output: ls -la ${outputPath}\n` +
    `   - File exists → DONE, stop immediately.\n` +
    `   - SCRIPT_ERROR → fix only that error, retry from step 3.\n` +
    `   - Never change the async IIFE structure or OUTPUT_PATH line.`;

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
    messages.push({ role: "assistant", content: response.content });

    const toolUseBlocks = response.content.filter((b) => b.type === "tool_use");

    if (toolUseBlocks.length === 0) {
      console.log("[agent] No tool_use blocks — finishing.");
      break;
    }

    const toolResults = [];

    for (const block of toolUseBlocks) {
      let result;
      try {
        const command = block.input?.command;
        if (!command) {
          result = "ERROR: tool_use block has no 'command' field";
        } else {
          console.log(`[agent] bash [${block.id.slice(-6)}]: ${command.slice(0, 100)}`);
          result = await runBash(command, workDir);
          console.log(`[agent] result: ${result.slice(0, 300)}`);
        }
      } catch (err) {
        result = `ERROR: ${err.message}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: result || "(no output)",
      });
    }

    messages.push({ role: "user", content: toolResults });

    if (fs.existsSync(outputPath)) {
      console.log("[agent] Output file detected — finishing early.");
      break;
    }
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error(`Agent finished but ${outputPath} was not created.`);
  }

  return outputPath;
}

module.exports = { generatePptx };
