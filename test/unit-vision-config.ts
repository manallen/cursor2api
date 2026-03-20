import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';

let passed = 0;
let failed = 0;

const repoRoot = resolve(process.cwd());
const configModuleUrl = pathToFileURL(resolve(repoRoot, 'src/config.ts')).href;
const visionModuleUrl = pathToFileURL(resolve(repoRoot, 'src/vision.ts')).href;
const VISION_ENV_KEYS = [
    'VISION_ENABLED',
    'VISION_MODE',
    'VISION_BASE_URL',
    'VISION_BASEURL',
    'VISION_API_KEY',
    'VISION_APIKEY',
    'VISION_MODEL',
    'VISION_PROXY',
];

async function test(name: string, fn: () => Promise<void> | void) {
    try {
        await fn();
        console.log(`  ✅  ${name}`);
        passed++;
    } catch (e) {
        console.error(`  ❌  ${name}`);
        console.error(`      ${(e as Error).message}`);
        failed++;
    }
}

function assert(condition: unknown, msg?: string): asserts condition {
    if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual<T>(actual: T, expected: T, msg?: string) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new Error(msg || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function clearVisionEnv() {
    for (const key of VISION_ENV_KEYS) {
        delete process.env[key];
    }
}

async function importFresh<T>(moduleUrl: string): Promise<T> {
    return import(`${moduleUrl}?t=${Date.now()}-${Math.random()}`) as Promise<T>;
}

async function withTempCwd(fn: (dir: string) => Promise<void>) {
    const dir = mkdtempSync(join(tmpdir(), 'cursor2api-vision-'));
    const prev = process.cwd();
    clearVisionEnv();
    process.chdir(dir);
    try {
        await fn(dir);
    } finally {
        process.chdir(prev);
        clearVisionEnv();
        rmSync(dir, { recursive: true, force: true });
    }
}

console.log('\n📦 [1] Vision 配置来源\n');

await test('仅靠环境变量时可创建 vision 配置并自动切到 api 模式', async () => {
    await withTempCwd(async () => {
        process.env.VISION_BASE_URL = 'https://openrouter.ai/api/v1';
        process.env.VISION_API_KEY = 'sk-env-key';
        process.env.VISION_MODEL = 'openrouter/vision-model';

        const { getConfig } = await importFresh<typeof import('../src/config.ts')>(configModuleUrl);
        const cfg = getConfig();

        assert(cfg.vision, 'vision 配置应被创建');
        assertEqual(cfg.vision?.enabled, true);
        assertEqual(cfg.vision?.mode, 'api');
        assertEqual(cfg.vision?.baseUrl, 'https://openrouter.ai/api/v1');
        assertEqual(cfg.vision?.apiKey, 'sk-env-key');
        assertEqual(cfg.vision?.model, 'openrouter/vision-model');
    });
});

await test('环境变量应覆盖 config.yaml 中的 vision 配置', async () => {
    await withTempCwd(async () => {
        writeFileSync('config.yaml', [
            'vision:',
            '  enabled: true',
            '  mode: ocr',
            '  base_url: "https://api.openai.com/v1/chat/completions"',
            '  api_key: "yaml-key"',
            '  model: "yaml-model"',
        ].join('\n'));

        process.env.VISION_MODE = 'api';
        process.env.VISION_BASE_URL = 'https://openrouter.ai/api/v1';
        process.env.VISION_API_KEY = 'sk-env-key';
        process.env.VISION_MODEL = 'env-model';

        const { getConfig } = await importFresh<typeof import('../src/config.ts')>(configModuleUrl);
        const cfg = getConfig();

        assertEqual(cfg.vision?.mode, 'api');
        assertEqual(cfg.vision?.baseUrl, 'https://openrouter.ai/api/v1');
        assertEqual(cfg.vision?.apiKey, 'sk-env-key');
        assertEqual(cfg.vision?.model, 'env-model');
    });
});

await test('config.yaml 的 vision 驼峰字段也能被识别', async () => {
    await withTempCwd(async () => {
        writeFileSync('config.yaml', [
            'vision:',
            '  enabled: true',
            '  mode: api',
            '  baseUrl: "https://openrouter.ai/api/v1"',
            '  apiKey: "yaml-camel-key"',
            '  model: "yaml-camel-model"',
        ].join('\n'));

        const { getConfig } = await importFresh<typeof import('../src/config.ts')>(configModuleUrl);
        const cfg = getConfig();

        assertEqual(cfg.vision?.baseUrl, 'https://openrouter.ai/api/v1');
        assertEqual(cfg.vision?.apiKey, 'yaml-camel-key');
        assertEqual(cfg.vision?.model, 'yaml-camel-model');
    });
});

console.log('\n📦 [2] Vision API 端点归一化\n');

await test('根域名应补全到 /v1/chat/completions', async () => {
    const { normalizeVisionApiEndpoint } = await importFresh<typeof import('../src/vision.ts')>(visionModuleUrl);
    assertEqual(normalizeVisionApiEndpoint('https://api.openai.com'), 'https://api.openai.com/v1/chat/completions');
});

await test('/v1 基址应补全到 /chat/completions', async () => {
    const { normalizeVisionApiEndpoint } = await importFresh<typeof import('../src/vision.ts')>(visionModuleUrl);
    assertEqual(normalizeVisionApiEndpoint('https://openrouter.ai/api/v1'), 'https://openrouter.ai/api/v1/chat/completions');
});

await test('完整 chat/completions 端点应保持不变', async () => {
    const { normalizeVisionApiEndpoint } = await importFresh<typeof import('../src/vision.ts')>(visionModuleUrl);
    assertEqual(
        normalizeVisionApiEndpoint('https://api.openai.com/v1/chat/completions'),
        'https://api.openai.com/v1/chat/completions',
    );
});

console.log('\n' + '═'.repeat(55));
console.log(`  结果: ${passed} 通过 / ${failed} 失败 / ${passed + failed} 总计`);
console.log('═'.repeat(55) + '\n');

if (failed > 0) process.exit(1);
