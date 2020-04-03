import * as fs from 'fs';
import * as path from 'path';
import * as events from 'events';

// Puppeteer Defaults
import * as Puppeteer from 'puppeteer';

if (!Puppeteer) {
  throw new Error('Please install puppeteer');
}

import * as errors from 'puppeteer/Errors';
import * as devices from 'puppeteer/DeviceDescriptors';

export { errors, devices };

const browserEvents = new events.EventEmitter();

export async function connect(options?: Puppeteer.ConnectOptions): Promise<Puppeteer.Browser> {
  const browser = await Puppeteer.connect(options);

  for (const plugin of plugins) {
    await plugin.init(browser);
  }

  const _close = browser.close;
  browser.close = async () => {
    await _close.apply(browser);
    browserEvents.emit('close');
  };

  return browser;
}

/** The default flags that Chromium will be launched with */
export function defaultArgs(options?: Puppeteer.ChromeArgOptions): string[] {
  return Puppeteer.defaultArgs(options);
}

/** Path where Puppeteer expects to find bundled Chromium */
export function executablePath(): string {
  return Puppeteer.executablePath();
}

/** The method launches a browser instance with given arguments. The browser will be closed when the parent node.js process is closed. */
export async function launch(options?: Puppeteer.LaunchOptions): Promise<Puppeteer.Browser> {
  const browser = await Puppeteer.launch({ defaultViewport: null, ...options });

  for (const plugin of plugins) {
    await plugin.init(browser);
  }

  const _close = browser.close;
  browser.close = async () => {
    await _close.apply(browser);
    browserEvents.emit('close');
  };

  return browser;
}

/** This methods attaches Puppeteer to an existing Chromium instance. */
export function createBrowserFetcher(options?: Puppeteer.FetcherOptions): Puppeteer.BrowserFetcher {
  return Puppeteer.createBrowserFetcher(options);
}

// Added methods
const sleep = (time: number) => { return new Promise(resolve => { setTimeout(resolve, time); }); };

interface Plugin {
  stopped: boolean;
  init: (browser: Puppeteer.Browser) => Promise<void>;
  restart: () => Promise<void>;
  stop: () => Promise<void>;
  onPageCreated?: (target: Puppeteer.Target, ...args: any[]) => Promise<void>;
  onRequest?: (request: Puppeteer.Request) => Promise<void>;
}

let plugins: Plugin[] = [];
export function clearPlugins() {
  plugins = [];
}

let anonymizeUserAgentPlugin: Plugin;
export function anonymizeUserAgent() {
  if (anonymizeUserAgentPlugin) {
    if (!plugins.includes(anonymizeUserAgentPlugin)) {
      plugins.push(anonymizeUserAgentPlugin);
    }

    return anonymizeUserAgentPlugin;
  }

  interface Page {
    target: Puppeteer.Page;
    userAgent: string;
    newUserAgent: string;
  }

  let pages: Page[] = [];

  const plugin = {
    stopped: false,
    init: async (browser: Puppeteer.Browser) => {
      browser.on('targetcreated', plugin.onPageCreated);

      browserEvents.on('close', () => {
        browser.off('targetcreated', plugin.onPageCreated);
        pages = [];
      });

      const _newPage = browser.newPage;
      browser.newPage = async (): Promise<Puppeteer.Page> => {
        const page = await _newPage.apply(browser);
        await sleep(10);
        return page;
      };

      await plugin.restart();
    },
    restart: async () => {
      plugin.stopped = false;

      for (const page of pages) {
        if (page.target.isClosed()) continue;

        await page.target.setUserAgent(page.newUserAgent);
      }
    },
    stop: async () => {
      plugin.stopped = true;

      for (const page of pages) {
        if (page.target.isClosed()) continue;

        await page.target.setUserAgent(page.userAgent);
      }
    },
    onPageCreated: async (target: Puppeteer.Target, ..._args: any[]) => {
      if (target.type() !== 'page') return;

      const page = await target.page();
      const userAgent = await page.browser().userAgent();
      const newUserAgent = userAgent
        .replace('HeadlessChrome/', 'Chrome/')
        .replace(/\(([^)]+)\)/, '(Windows NT 10.0; Win64; x64)');

      pages.push({ target: page, userAgent, newUserAgent });

      if (!plugin.stopped) {
        if (page.isClosed()) return;

        await page.setUserAgent(newUserAgent);
      }
    }
  };

  anonymizeUserAgentPlugin = plugin;
  plugins.push(plugin);

  return { restart: plugin.restart, stop: plugin.stop };
}

let avoidDetectionPlugin: Plugin;
export function avoidDetection() {
  if (avoidDetectionPlugin) {
    if (!plugins.includes(avoidDetectionPlugin)) {
      plugins.push(avoidDetectionPlugin);
    }

    return avoidDetectionPlugin;
  }

  const pluginDependency = anonymizeUserAgent();

  const injectionsFolder = path.resolve(`${__dirname}/injections`);
  const injections = fs.readdirSync(injectionsFolder).map(fileName => require(`${injectionsFolder}/${fileName}`));

  const plugin = {
    stopped: false,
    init: async (browser: Puppeteer.Browser) => {
      browser.on('targetcreated', plugin.onPageCreated);

      browserEvents.on('close', () => {
        browser.off('targetcreated', plugin.onPageCreated);
      });

      await plugin.restart();
    },
    restart: async () => {
      plugin.stopped = false;

      await pluginDependency.restart();
    },
    stop: async () => {
      plugin.stopped = true;

      await pluginDependency.stop();
    },
    onPageCreated: async (target: Puppeteer.Target, ..._args: any[]) => {
      if (target.type() !== 'page') return;

      const page = await target.page();

      await page.exposeFunction('isStopped', () => plugin.stopped);

      for (const injection of injections) {
        await page.evaluateOnNewDocument(injection);
      }
    }
  };

  avoidDetectionPlugin = plugin;
  plugins.push(plugin);

  return { restart: plugin.restart, stop: plugin.stop };
}

type resourceType = 'document' | 'stylesheet' | 'image' | 'media' | 'font' | 'script' | 'texttrack' | 'xhr' | 'fetch' | 'eventsource' | 'websocket' | 'manifest' | 'other';
let blockResourcesPlugin: Plugin;
export function blockResources(...resources: resourceType[]) {
  if (blockResourcesPlugin) {
    if (!plugins.includes(blockResourcesPlugin)) {
      plugins.push(blockResourcesPlugin);
    }

    return blockResourcesPlugin;
  }

  const plugin = {
    stopped: false,
    init: async (browser: Puppeteer.Browser) => {
      browser.on('targetcreated', plugin.onPageCreated);

      browserEvents.on('close', () => {
        browser.off('targetcreated', plugin.onPageCreated);
      });

      await plugin.restart();
    },
    restart: async () => {
      plugin.stopped = false;
    },
    stop: async () => {
      plugin.stopped = true;
    },
    onPageCreated: async (target: Puppeteer.Target, ..._args: any[]) => {
      if (target.type() !== 'page') return;

      const page = await target.page();

      await page.setRequestInterception(true);
      page.on('request', plugin.onRequest);

      browserEvents.on('close', () => {
        page.off('request', plugin.onRequest);
      });
    },
    onRequest: async (request: Puppeteer.Request) => {
      const interceptionHandled = (request as any)._interceptionHandled;

      if (interceptionHandled) return;
      if (plugin.stopped) return request.continue();
      return resources.includes(request.resourceType()) ? request.abort() : request.continue();
    }
  };

  blockResourcesPlugin = plugin;
  plugins.push(plugin);

  return { restart: plugin.restart, stop: plugin.stop };
}