'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');

const WORKER = path.join(__dirname, '..', 'python', 'engine.py');
const MAX_OUTPUT = 2 * 1024 * 1024;

function runPythonEngine(operation, payload = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON_BINARY || 'python3', [WORKER], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      child.kill();
      finish(new Error(`Python operation timed out: ${operation}`));
    }, 5_000);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > MAX_OUTPUT) {
        child.kill();
        finish(new Error('Python output exceeded the safety limit'));
      }
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', error => finish(error));
    child.on('close', code => {
      if (settled) return;
      if (code !== 0) return finish(new Error(stderr.trim() || `Python worker exited with code ${code}`));
      try {
        return finish(null, JSON.parse(stdout));
      } catch (error) {
        return finish(new Error(`Invalid response from Python worker: ${error.message}`));
      }
    });

    child.stdin.end(JSON.stringify({ operation, payload }));
  });
}

module.exports = { runPythonEngine };
