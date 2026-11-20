import { describe, expect, test } from "bun:test";
import {
  cloudAutoShareMatches,
  isCloudSharePageUrl,
  supportsCloudShareAutoDownload,
} from "./cloud-sites";

describe("isCloudSharePageUrl", () => {
  test("识别各网盘真实分享路径", () => {
    expect(isCloudSharePageUrl("https://pan.baidu.com/s/abc?pwd=1234")).toBe(true);
    expect(isCloudSharePageUrl("https://1814931019.share.123pan.cn/123pan/yPpeVv-WCTWh")).toBe(true);
    expect(isCloudSharePageUrl("https://cloud.189.cn/web/share?code=VbAnmuiq6Bfm")).toBe(true);
    expect(isCloudSharePageUrl("https://cloud.189.cn/t/AbCdEf123")).toBe(true);
    expect(isCloudSharePageUrl("https://yun.139.com/shareweb/#/w/i/2yA8y7Ni6Kz7i")).toBe(true);
    expect(isCloudSharePageUrl("https://yun.139.com/w/#/share?linkId=abc")).toBe(true);
  });

  test("拒绝网盘首页与普通文件页", () => {
    expect(isCloudSharePageUrl("https://pan.baidu.com/")).toBe(false);
    expect(isCloudSharePageUrl("https://cloud.189.cn/web/main")).toBe(false);
    expect(isCloudSharePageUrl("https://1814931019.share.123pan.cn/")).toBe(false);
  });
});

describe("cloudAutoShareMatches", () => {
  test("跳转丢失 query 后仍按 origin + pathname 匹配", () => {
    const now = Date.now();
    expect(cloudAutoShareMatches({ url: "https://pan.baidu.com/s/abc?fluxdown_auto=1", at: now }, "https://pan.baidu.com/s/abc")).toBe(true);
    expect(cloudAutoShareMatches({ url: "https://pan.baidu.com/s/abc", at: now }, "https://pan.baidu.com/s/other")).toBe(false);
    expect(cloudAutoShareMatches({ url: "https://pan.baidu.com/s/abc", at: now - 11 * 60 * 1000 }, "https://pan.baidu.com/s/abc")).toBe(false);
    expect(cloudAutoShareMatches({ url: "http://pan.baidu.com/s/abc", at: now }, "http://pan.baidu.com/s/abc")).toBe(false);
  });
});

describe("supportsCloudShareAutoDownload", () => {
  test("仅对已验证可自动提链的厂商开启", () => {
    expect(supportsCloudShareAutoDownload("pan123")).toBe(true);
    expect(supportsCloudShareAutoDownload("baidu")).toBe(true);
    expect(supportsCloudShareAutoDownload("tcloud")).toBe(false);
    expect(supportsCloudShareAutoDownload("mcloud")).toBe(false);
  });
});
