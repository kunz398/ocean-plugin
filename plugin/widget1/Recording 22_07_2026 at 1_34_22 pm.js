import fs from 'fs';
import { Locator, launch } from 'puppeteer'; // v25.0.0 or later

const browser = await launch();
const page = await browser.newPage();
const timeout = 5000;
page.setDefaultTimeout(timeout);

const lhApi = await import('lighthouse'); // v10.0.0 or later
const flags = {
    screenEmulation: {
        disabled: true
    }
}
const config = lhApi.desktopConfig;
const lhFlow = await lhApi.startFlow(page, {name: 'Recording 22/07/2026 at 1:34:22 pm', config, flags});
{
    const targetPage = page;
    await targetPage.setViewport({
        width: 1419,
        height: 948
    })
}
await lhFlow.startNavigation();
{
    const targetPage = page;
    await targetPage.goto('http://localhost:3001/');
}
await lhFlow.endNavigation();
await lhFlow.startTimespan();
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Mean Period forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[2])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Mean Period)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 73.8125,
            y: 19.96875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wave Period forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[3])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(3)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 87.40625,
            y: 19.796875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Inundation forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[4])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(4)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 79.8125,
            y: 42.796875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Vessel Suitability forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(5)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[5])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(5)'),
        targetPage.locator('::-p-text(Vessel Suitability)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 142.40625,
            y: 40.62158203125,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Very Small Motorised Craft)'),
        targetPage.locator('div.suitability-control-card--vessel button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[3]/div[2]/div[2]/button[2])'),
        targetPage.locator(':scope >>> div.suitability-control-card--vessel button:nth-of-type(2)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 37.3125,
            y: 0.9375,
          },
        });
}
{
    const targetPage = page;
    let frame = targetPage.mainFrame();
    frame = frame.childFrames()[0];
    await Locator.race([
        frame.locator('::-p-aria(Dismiss)'),
        frame.locator('button'),
        frame.locator('::-p-xpath(//*[@id=\\"webpack-dev-server-client-overlay-div\\"]/button)'),
        frame.locator(':scope >>> button'),
        frame.locator('::-p-text(×)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 19.015625,
            y: 16,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Small Craft) >>>> ::-p-aria([role=\\"generic\\"])'),
        targetPage.locator('div.suitability-control-card--vessel button:nth-of-type(3) > span'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[3]/div[2]/div[2]/button[3]/span)'),
        targetPage.locator(':scope >>> div.suitability-control-card--vessel button:nth-of-type(3) > span'),
        targetPage.locator('::-p-text(Small Craft)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 52.65625,
            y: 11.546875,
          },
        });
}
{
    const targetPage = page;
    let frame = targetPage.mainFrame();
    frame = frame.childFrames()[0];
    await Locator.race([
        frame.locator('::-p-aria(Dismiss)'),
        frame.locator('button'),
        frame.locator('::-p-xpath(//*[@id=\\"webpack-dev-server-client-overlay-div\\"]/button)'),
        frame.locator(':scope >>> button'),
        frame.locator('::-p-text(×)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 21.015625,
            y: 15,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Larger Vessels) >>>> ::-p-aria([role=\\"generic\\"])'),
        targetPage.locator('div.suitability-control-card--vessel button:nth-of-type(4) > span'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[3]/div[2]/div[2]/button[4]/span)'),
        targetPage.locator(':scope >>> div.suitability-control-card--vessel button:nth-of-type(4) > span'),
        targetPage.locator('::-p-text(Larger Vessels)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 26.671875,
            y: 1.546875,
          },
        });
}
{
    const targetPage = page;
    let frame = targetPage.mainFrame();
    frame = frame.childFrames()[0];
    await Locator.race([
        frame.locator('::-p-aria(Dismiss)'),
        frame.locator('button'),
        frame.locator('::-p-xpath(//*[@id=\\"webpack-dev-server-client-overlay-div\\"]/button)'),
        frame.locator(':scope >>> button'),
        frame.locator('::-p-text(×)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 10.015625,
            y: 12,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Traditional Craft) >>>> ::-p-aria([role=\\"generic\\"])'),
        targetPage.locator('div.suitability-control-card--vessel button:nth-of-type(1) > span'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[3]/div[2]/div[2]/button[1]/span)'),
        targetPage.locator(':scope >>> div.suitability-control-card--vessel button:nth-of-type(1) > span'),
        targetPage.locator('::-p-text(Traditional Craft)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 103.734375,
            y: 19.9375,
          },
        });
}
{
    const targetPage = page;
    let frame = targetPage.mainFrame();
    frame = frame.childFrames()[0];
    await Locator.race([
        frame.locator('::-p-aria(Dismiss)'),
        frame.locator('button'),
        frame.locator('::-p-xpath(//*[@id=\\"webpack-dev-server-client-overlay-div\\"]/button)'),
        frame.locator(':scope >>> button'),
        frame.locator('::-p-text(×)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 25.015625,
            y: 20,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Small Craft) >>>> ::-p-aria([role=\\"generic\\"])'),
        targetPage.locator('div.suitability-control-card--vessel button:nth-of-type(3) > span'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[3]/div[2]/div[2]/button[3]/span)'),
        targetPage.locator(':scope >>> div.suitability-control-card--vessel button:nth-of-type(3) > span'),
        targetPage.locator('::-p-text(Small Craft)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 76.65625,
            y: 10.546875,
          },
        });
}
{
    const targetPage = page;
    let frame = targetPage.mainFrame();
    frame = frame.childFrames()[0];
    await Locator.race([
        frame.locator('::-p-aria(Dismiss)'),
        frame.locator('button'),
        frame.locator('::-p-xpath(//*[@id=\\"webpack-dev-server-client-overlay-div\\"]/button)'),
        frame.locator(':scope >>> button'),
        frame.locator('::-p-text(×)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 24.015625,
            y: 24,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Larger Vessels) >>>> ::-p-aria([role=\\"generic\\"])'),
        targetPage.locator('div.suitability-control-card--vessel button:nth-of-type(4) > span'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[3]/div[2]/div[2]/button[4]/span)'),
        targetPage.locator(':scope >>> div.suitability-control-card--vessel button:nth-of-type(4) > span'),
        targetPage.locator('::-p-text(Larger Vessels)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 58.671875,
            y: 6.546875,
          },
        });
}
{
    const targetPage = page;
    let frame = targetPage.mainFrame();
    frame = frame.childFrames()[0];
    await Locator.race([
        frame.locator('::-p-aria(Dismiss)'),
        frame.locator('button'),
        frame.locator('::-p-xpath(//*[@id=\\"webpack-dev-server-client-overlay-div\\"]/button)'),
        frame.locator(':scope >>> button'),
        frame.locator('::-p-text(×)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 28.015625,
            y: 16,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Significant Wave Height forecast variable)'),
        targetPage.locator('div.controls-panel > div > div:nth-of-type(1) button:nth-of-type(1)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[1])'),
        targetPage.locator(':scope >>> div.controls-panel > div > div:nth-of-type(1) button:nth-of-type(1)'),
        targetPage.locator('::-p-text(Significant Wave)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 72.40625,
            y: 44.96875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Mean Period forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[2])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(2)'),
        targetPage.locator('::-p-text(Mean Period)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 32.8125,
            y: 26.96875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Wave Period forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(3)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[3])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(3)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 64.40625,
            y: 27.796875,
          },
        });
}
{
    const targetPage = page;
    await Locator.race([
        targetPage.locator('::-p-aria(Inundation forecast variable)'),
        targetPage.locator('div.controls-panel button:nth-of-type(4)'),
        targetPage.locator('::-p-xpath(//*[@id=\\"root\\"]/div/div/div/div/div[2]/div/div[1]/div/button[4])'),
        targetPage.locator(':scope >>> div.controls-panel button:nth-of-type(4)')
    ])
        .setTimeout(timeout)
        .click({
          offset: {
            x: 40.8125,
            y: 30.796875,
          },
        });
}
await lhFlow.endTimespan();
const lhFlowReport = await lhFlow.generateReport();
fs.writeFileSync(import.meta.dirname + '/flow.report.html', lhFlowReport)

await browser.close();

