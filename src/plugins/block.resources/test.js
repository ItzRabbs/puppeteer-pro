const PuppeteerPro = require('../../../dist/index');
const chai = require('chai');

const expect = chai.expect;

class AbortPlugin extends PuppeteerPro.Plugin {
  constructor() {
    super();
    this.requiresInterception = true;
  }
  async processRequest(request) {
    await request.continue();
  }
}

// Test multiple request handlers at once
module.exports = plugin => async browserWSEndpoint => {
  PuppeteerPro.addPlugin(new AbortPlugin());

  const browser = browserWSEndpoint ? await PuppeteerPro.connect({ browserWSEndpoint }) : await PuppeteerPro.launch();
  let page;

  try {
    page = await browser.newPage();

    const getResult = async () => {
      try {
        await page.goto('http://www.google.com');
        return false;
      }
      catch (ex) {
        return true;
      }
    };

    expect(await getResult()).to.be.true;

    await plugin.stop();
    expect(await getResult()).to.be.false;

    await plugin.restart();
    expect(await getResult()).to.be.true;
  }
  finally {
    if (page) await page.close();
    if (browser) await browser.close();
  }
};