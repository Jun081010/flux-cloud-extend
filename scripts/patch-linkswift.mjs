import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptDirectory, "..");
const sourceFile = join(projectRoot, "vendor", "LinkSwift", "linkswift.user.js");
const outputDirectory = join(projectRoot, "app", "public", "cloud");
const outputFile = join(outputDirectory, "linkswift.user.js");
const vendorOutputDirectory = join(outputDirectory, "vendor");
const wrapperFile = join(outputDirectory, "linkswift.bundle.js");

const HEADER_COMMENT = "// Patched for FluxDown Cloud Extension; upstream LinkSwift AGPL-3.0.\r\n";

const LOCAL_DEPENDENCIES = [
  ["jquery.min.js", "jquery.min.js"],
  ["sweetalert2.min.js", "sweetalert2.min.js"],
  ["md5.min.js", "md5.min.js"],
  ["sweetalert2.min.css", "sweetalert2.min.css"],
  ["sweetalert2-dark.min.css", "sweetalert2-dark.min.css"],
];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function countMatches(text, needle) {
  if (needle.length === 0) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = text.indexOf(needle, offset);
    if (index === -1) return count;
    count += 1;
    offset = index + needle.length;
  }
}

function applyStringPatch(text, name, needle, replacement, expectedCount = 1) {
  const count = countMatches(text, needle);
  if (count !== expectedCount) {
    throw new Error(`patch "${name}": expected ${expectedCount} anchor(s), found ${count}`);
  }
  if (expectedCount === 1) return text.replace(needle, replacement);
  return text.split(needle).join(replacement);
}

function applyRegexPatch(text, name, pattern, replacer, expectedCount) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = text.match(new RegExp(pattern.source, flags));
  const count = matches ? matches.length : 0;
  if (count !== expectedCount) {
    throw new Error(`patch "${name}": expected ${expectedCount} anchor(s), found ${count}`);
  }
  return text.replace(new RegExp(pattern.source, flags), replacer);
}

function applyInsertionPatch(text, name, anchor, insertion, expectedCount = 1) {
  const count = countMatches(text, anchor);
  if (count !== expectedCount) {
    throw new Error(`patch "${name}": expected ${expectedCount} anchor(s), found ${count}`);
  }
  return text.replace(anchor, insertion + "\r\n" + anchor);
}

function assertAnchors(text, anchors) {
  for (const [name, needle, expectedCount] of anchors) {
    const count = countMatches(text, needle);
    if (count !== expectedCount) {
      throw new Error(`anchor "${name}": expected ${expectedCount}, found ${count}`);
    }
  }
}

const SRC_METHOD_CONFIG = "\t\t\t\t\tabdm: {\r\n\t\t\t\t\t\ttitle: \"ABDM 下载\",\r\n\t\t\t\t\t\tfooter: `<p>适用于 <a href=\"https://abdownloadmanager.com/\" target=\"_blank\" class=\"pl-a\" data-no-instant=\"1\"><svg class=\"pl-icon\"><use xlink:href=\"#pl-icon-fa-link\"></use></svg>AB Download Manager</a></p>`\r\n\t\t\t\t\t}";

const OUT_METHOD_CONFIG = "\t\t\t\t\tabdm: {\r\n\t\t\t\t\t\ttitle: \"ABDM 下载\",\r\n\t\t\t\t\t\tfooter: `<p>适用于 <a href=\"https://abdownloadmanager.com/\" target=\"_blank\" class=\"pl-a\" data-no-instant=\"1\"><svg class=\"pl-icon\"><use xlink:href=\"#pl-icon-fa-link\"></use></svg>AB Download Manager</a></p>`\r\n\t\t\t\t\t},\r\n\t\t\t\t\tfluxdown: {\r\n\t\t\t\t\t\ttitle: \"FluxDown 下载\",\r\n\t\t\t\t\t\tfooter: `<p>通过浏览器扩展把直链、文件名与请求头发送到本机 FluxDown 下载器。</p>`\r\n\t\t\t\t\t}";

const SRC_FILE_ROW = "\t\t\t\t\tif (temp.mode === \"api\") {\r\n\t\t\t\t\t\tallLink.push(link);";

const OUT_FILE_ROW = "\t\t\t\t\tif (temp.mode === \"fluxdown\") {\r\n\t\t\t\t\t\tallLink.push(link);\r\n\t\t\t\t\t\tcontent.find(`.${mount}.main`).append(`<div class=\"item\" data-index=\"${i}\" data-link=\"${link}\" data-name=\"${name}\" data-size=\"${size}\">\r\n\t\t\t\t\t\t\t<div class=\"name ${mount} tip\"><div class=\"name\">${name}</div><div class=\"size\">${base.sizeFormat(size)}</div></div>\r\n\r\n\t\t\t\t\t\t\t<button action=\"sendto\" type=\"fluxdown\" class=\"${mount} btn default mini\"><svg class=\"pl-icon\"><use xlink:href=\"#pl-icon-fa-cloud-arrow-up\"/></svg><span>推送至 FluxDown</span></button>\r\n\r\n\t\t\t\t\t\t\t<button action=\"copy\" type=\"file.link\" class=\"${mount} btn warning mini tip\" data-title=\"${config.base.dom.copy.link}\"><svg class=\"pl-icon\"><use xlink:href=\"#pl-icon-fa-copy\"/></svg>复制地址</button>\r\n\t\t\t\t\t\t</div>`);\r\n\t\t\t\t\t} else if (temp.mode === \"api\") {\r\n\t\t\t\t\t\tallLink.push(link);";

const SRC_EXTRA = "\t\t\tif (temp.mode === \"api\") {\r\n\t\t\t\tconst rpc = base.getValue(\"setting_idm_rpc\");";

const OUT_EXTRA = "\t\t\tif (temp.mode === \"fluxdown\") {\r\n\t\t\t\tcontent.find(`.${mount}.extra`).append(`<button action=\"copy\" type=\"all.file.link\" class=\"${mount} btn warning mini tip\" data-title=\"${config.base.dom.copy.all.link}\"><svg class=\"pl-icon\"><use xlink:href=\"#pl-icon-fa-copy\"/></svg>复制全部地址</button>`);\r\n\t\t\t\tif (files.length >= 2) content.find(`.${mount}.extra`).append(`<button action=\"all\" type=\"sendto.fluxdown\" class=\"${mount} btn default mini\"><svg class=\"pl-icon\"><use xlink:href=\"#pl-icon-fa-cloud-arrow-up\"/></svg>全部推送至 FluxDown</button>`);\r\n\t\t\t} else if (temp.mode === \"api\") {\r\n\t\t\t\tconst rpc = base.getValue(\"setting_idm_rpc\");";

const SRC_SENDTO_CASE = "\t\t\t\t\t\tcase \"abdm\": res = await download.tools.sendTo.abdm(link, name, headers); break;";

const OUT_SENDTO_CASE = "\t\t\t\t\t\tcase \"abdm\": res = await download.tools.sendTo.abdm(link, name, headers); break;\r\n\t\t\t\t\t\tcase \"fluxdown\": res = await download.tools.sendTo.fluxdown(link, name, size, headers); break;";

const SRC_METHOD_ANCHOR = "\t\t\t\t},\r\n\t\t\t},\r\n\t\t},\r\n\t}\r\n\r\n\t/**\r\n\t * 百度网盘";

const OUT_METHOD_ANCHOR = "\t\t\t\t},\r\n\t\t\t\t/**\r\n\t\t\t\t * 发送地址到 FluxDown 下载器\r\n\t\t\t\t * @param {String} link - 下载地址\r\n\t\t\t\t * @param {String} filename - 文件名\r\n\t\t\t\t * @param {Number} filesize - 文件大小\r\n\t\t\t\t * @param {Object} [headers] - 请求头对象（可选）\r\n\t\t\t\t * @returns {Promise<\"success\"|\"fail\">} 发送态结果\r\n\t\t\t\t */\r\n\t\t\t\tasync fluxdown(link, filename, filesize, headers = {}) {\r\n\t\t\t\t\tif (!this.fluxdown.lock) this.fluxdown.lock = Promise.resolve();\r\n\t\t\t\t\treturn this.fluxdown.lock = this.fluxdown.lock.then(async () => {\r\n\t\t\t\t\t\tif (typeof GM_fluxdownDownload !== \"function\") return \"fail\";\r\n\t\t\t\t\t\tconst payload = [{\r\n\t\t\t\t\t\t\turl: link,\r\n\t\t\t\t\t\t\tfilename,\r\n\t\t\t\t\t\t\tsize: filesize,\r\n\t\t\t\t\t\t\theaders: base.standHeaders(headers, true, false),\r\n\t\t\t\t\t\t\treferrer: location.href\r\n\t\t\t\t\t\t}];\r\n\t\t\t\t\t\ttry {\r\n\t\t\t\t\t\t\tconst response = await GM_fluxdownDownload(payload);\r\n\t\t\t\t\t\t\treturn response === \"success\" ? \"success\" : \"fail\";\r\n\t\t\t\t\t\t} catch {\r\n\t\t\t\t\t\t\treturn \"fail\";\r\n\t\t\t\t\t\t}\r\n\t\t\t\t\t});\r\n\t\t\t\t}\r\n\t\t\t},\r\n\t\t},\r\n\t}\r\n\r\n\t/**\r\n\t * 百度网盘";

const SRC_CONSOLE_CLEAR = "\tunsafeWindow.console.clear = new Function(base.decodeBase(\"Y29uc29sZS5sb2coIiVj5bey5riF6Zmk5o6n5Yi25Y+wIiwgImNvbG9yOmdyYXk7Zm9udC1zdHlsZTppdGFsaWMiKTs=\"));";

const OUT_CONSOLE_CLEAR = "\t// FluxDown Cloud Extension: omit user script manager console hook.";

const SRC_GLOBAL_INVOCATION = "})($ ?? jQuery);";
const OUT_GLOBAL_INVOCATION = "})($);";

const SRC_AUTO_ANCHOR = "\t\t\tbase.showMainDialog(config.base.dom.method[temp.mode].title, download.generateDOM(), config.base.dom.method[temp.mode].footer);\r\n\t\t},\r\n\t\tgetSelectedList() {";

const OUT_AUTO_METHODS = "\t\t\tbase.showMainDialog(config.base.dom.method[temp.mode].title, download.generateDOM(), config.base.dom.method[temp.mode].footer);\r\n\t\t},\r\n\t\tgetAutoShareFiles() {\r\n\t\t\tconst toArray = (x) => {\r\n\t\t\t\tif (x && typeof x === \"object\" && \"value\" in x) x = x.value;\r\n\t\t\t\treturn x ? Array.from(x) : [];\r\n\t\t\t};\r\n\t\t\tconst root = unsafeWindow.document.querySelector(\"#app\");\r\n\t\t\tconst listView = base.findVueComponent(\"ListView\", root);\r\n\t\t\tif (listView?.props?.files) return toArray(listView.props.files);\r\n\t\t\tconst shareHeader = base.findVueComponent(\"ShareHeader\", root);\r\n\t\t\tconst context = shareHeader?.props?.context;\r\n\t\t\tif (context?.pageKind === \"single\") return toArray(context.files);\r\n\t\t\tconst previewComp = base.findVueComponent([\"DocViewer\", \"FileInfoPreview\", \"PicturePreview\", \"AudioPreview\", \"VideoPreview\"], root);\r\n\t\t\tif (previewComp?.props?.file) return [previewComp.props.file];\r\n\t\t\treturn [];\r\n\t\t},\r\n\t\tasync autoDownloadToFluxDown() {\r\n\t\t\tconst deadline = Date.now() + 90000;\r\n\t\t\tlet selected = [];\r\n\t\t\twhile (Date.now() < deadline) {\r\n\t\t\t\tselected = this.getSelectedList();\r\n\t\t\t\tif (!selected.length) selected = this.getShareSelectedList();\r\n\t\t\t\tif (!selected.length) selected = this.getAutoShareFiles();\r\n\t\t\t\tselected = (selected || []).filter(item => item && !item.isdir);\r\n\t\t\t\tif (selected.length) break;\r\n\t\t\t\tawait base.sleep(1000);\r\n\t\t\t}\r\n\t\t\tif (!selected.length) throw new Error(\"未读取到分享文件；请确认提取码已通过，或先登录百度网盘\");\r\n\t\t\tconst token = base.getValue(\"baidu_access_token\") || await this.getToken().catch(() => \"\");\r\n\t\t\tif (!token) throw new Error(\"请先登录百度网盘，再重新拖动链接\");\r\n\t\t\tlet shareData = null;\r\n\t\t\tconst shareDeadline = Date.now() + 30000;\r\n\t\t\twhile (Date.now() < shareDeadline) {\r\n\t\t\t\tshareData = await this.getShareData();\r\n\t\t\t\tif (shareData?.share?.id && shareData?.share?.uk) break;\r\n\t\t\t\tawait base.sleep(800);\r\n\t\t\t}\r\n\t\t\tif (!shareData?.share?.id) throw new Error(\"分享页数据尚未就绪，请稍后重试\");\r\n\t\t\tconst sign = await base.get(config.$baidu.api.getShareSign + \"&surl=1\" + shareData.share.url + \"$bdstoken=\" + shareData.baidu.token + \"&logid=\" + base.encodeBase(shareData.baidu.id));\r\n\t\t\tif (sign?.data?.sign && sign?.data?.timestamp) {\r\n\t\t\t\tshareData.sign = sign.data.sign;\r\n\t\t\t\tshareData.timestamp = sign.data.timestamp;\r\n\t\t\t}\r\n\t\t\tconst extracted = await this.getShareFilesUrl(selected.map(item => ({ ...item })), shareData);\r\n\t\t\tconst items = extracted.filter(item => item && !item.isdir).map(item => {\r\n\t\t\t\tconst name = item.server_filename || item.filename || \"download\";\r\n\t\t\t\tlet link = item.dlink;\r\n\t\t\t\tif (typeof link === \"string\" && link.startsWith(\"http\")) {\r\n\t\t\t\t\tconst url = new URL(link);\r\n\t\t\t\t\turl.searchParams.set(\"access_token\", token);\r\n\t\t\t\t\tlink = url.href;\r\n\t\t\t\t}\r\n\t\t\t\treturn {\r\n\t\t\t\t\turl: link,\r\n\t\t\t\t\tfilename: name,\r\n\t\t\t\t\tsize: Number(item.size) || 0,\r\n\t\t\t\t\theaders: { \"User-Agent\": config.$baidu.api.ua.downloadLink },\r\n\t\t\t\t\treferrer: location.href\r\n\t\t\t\t};\r\n\t\t\t}).filter(item => typeof item.url === \"string\" && /^https:\\/\\//.test(item.url));\r\n\t\t\tif (!items.length) {\r\n\t\t\t\tconst reason = extracted.find(item => typeof item?.dlink === \"string\" && item.dlink)?.dlink;\r\n\t\t\t\tthrow new Error(typeof reason === \"string\" ? reason.replace(/<[^>]+>/g, \"\") : \"未获取到可用直链\");\r\n\t\t\t}\r\n\t\t\tconst result = await GM_fluxdownDownload(items);\r\n\t\t\tif (result !== \"success\") throw new Error(\"FluxDown 未接收任务，请确认桌面端已启动\");\r\n\t\t\treturn items.length;\r\n\t\t},\r\n\t\tgetSelectedList() {";

const SRC_AUTO_TRIGGER = "\t\t\t// 运行主程序\r\n\t\t\tif (\"initPanLinker\" in temp.main) temp.main.initPanLinker();";

const OUT_AUTO_TRIGGER = "\t\t\t// 运行主程序\r\n\t\t\tif (\"initPanLinker\" in temp.main) temp.main.initPanLinker();\r\n\r\n\t\t\t// FluxDown 自动转直链模式：拖动分享链接打开页面后直接提链并推送下载器\r\n\t\t\tconst fluxdownAuto = new URL(location.href).searchParams.get(\"fluxdown_auto\") === \"1\";\r\n\t\t\tif (fluxdownAuto && temp.main === $baidu) {\r\n\t\t\t\ttry {\r\n\t\t\t\t\tconst clean = new URL(location.href);\r\n\t\t\t\t\tclean.searchParams.delete(\"fluxdown_auto\");\r\n\t\t\t\t\thistory.replaceState(history.state, \"\", clean.href);\r\n\t\t\t\t} catch { }\r\n\t\t\t\tsetTimeout(async () => {\r\n\t\t\t\t\ttry {\r\n\t\t\t\t\t\tconst count = await $baidu.autoDownloadToFluxDown();\r\n\t\t\t\t\t\tmessage.success(\"FluxDown：已自动加入 \" + count + \" 个下载任务\");\r\n\t\t\t\t\t} catch (error) {\r\n\t\t\t\t\t\tconst safe = $(\"<div>\").text(String(error?.message || error)).html();\r\n\t\t\t\t\t\tmessage.error(\"FluxDown 自动下载失败：<br/>\" + safe);\r\n\t\t\t\t\t}\r\n\t\t\t\t}, 1200);\r\n\t\t\t}";

const SRC_AUTO_METHOD_INSERT = "\t\tgetSelectedList() {\r\n\t\t\ttry {\r\n\t\t\t\tlet list = [];\r\n\t\t\t\t// 3\r\n\t\t\t\tconst fileList = unsafeWindow.document.querySelector(\".file-list\");";

const SRC_GENERIC_AUTO_ANCHOR = "const $baidu = {";

const GENERIC_AUTO_METHOD = [
  "\tfunction fluxdownAutoClearPending() {",
  "\t\ttry { sessionStorage.removeItem(\"fluxdown_auto_pending\"); } catch { }",
  "\t\ttry { base.delValue(\"fluxdown_auto_share\"); } catch { }",
  "\t\ttry {",
  "\t\t\tconst done = new URL(location.href);",
  "\t\t\tdone.searchParams.delete(\"fluxdown_auto\");",
  "\t\t\thistory.replaceState(history.state, \"\", done.href);",
  "\t\t} catch { }",
  "\t}",
  "",
  "\tfunction fluxdownAutoTickFirstFile() {",
  "\t\tconst boxes = Array.from(document.querySelectorAll('input[type=\"checkbox\"], [role=\"checkbox\"], .ant-checkbox-input'));",
  "\t\tfor (const box of boxes) {",
  "\t\t\tconst rect = box.getBoundingClientRect();",
  "\t\t\tif (rect.width < 4 || rect.height < 4) continue;",
  "\t\t\tif (box.checked === true || box.getAttribute(\"aria-checked\") === \"true\") continue;",
  "\t\t\ttry { box.click(); } catch { }",
  "\t\t\treturn true;",
  "\t\t}",
  "\t\treturn false;",
  "\t}",
  "",
  "\tasync function fluxdownAutoDownloadCurrent() {",
  "\t\tconst deadline = Date.now() + 90000;",
  "\t\tlet selected = [];",
  "\t\tlet hinted = false;",
  "\t\twhile (Date.now() < deadline) {",
  "\t\t\tselected = temp.main?.getSelectedList?.() || [];",
  "\t\t\tif (!selected.length) selected = temp.main?.getAutoShareFiles?.() || [];",
  "\t\t\tselected = (selected || []).filter(Boolean);",
  "\t\t\tif (selected.length) break;",
  "\t\t\tif (!hinted) {",
  "\t\t\t\thinted = true;",
  "\t\t\t\tmessage.info(\"FluxDown：请确认提取码并登录网盘，读取到文件后会自动继续\");",
  "\t\t\t}",
  "\t\t\tfluxdownAutoTickFirstFile();",
  "\t\t\tawait base.sleep(1000);",
  "\t\t}",
  "\t\tif (!selected.length) throw new Error(\"未读取到分享文件；请登录后勾选文件，再重新拖动分享链接\");",
  "\t\tconst isDir = value => value && (value.Type !== undefined ? value.Type !== 0 : value.file === false || value.resType == 2 || value.isdir === true);",
  "\t\tif (selected.every(isDir)) throw new Error(\"这是文件夹分享：请先打开文件夹并勾选文件，再重新拖动分享链接\");",
  "\t\ttemp.page = temp.main?.detectPage?.() || temp.page;",
  "\t\ttemp.mode = \"fluxdown\";",
  "\t\tawait temp.main.getLink();",
  "\t\tconst files = Array.isArray(temp.files) && Array.isArray(temp.files[0]) ? temp.files[0] : [];",
  "\t\tconst descriptor = Array.isArray(temp.files) ? temp.files[1] : null;",
  "\t\tif (!descriptor?.get) throw new Error(\"未获取到文件信息，请刷新页面后重试\");",
  "\t\tconst items = files",
  "\t\t\t.filter(value => value && !(descriptor.get.dir?.(value)))",
  "\t\t\t.map(value => ({",
  "\t\t\t\turl: descriptor.get.link?.(value),",
  "\t\t\t\tfilename: descriptor.get.name?.(value) || \"download\",",
  "\t\t\t\tsize: Number(descriptor.get.size?.(value)) || 0,",
  "\t\t\t\theaders: base.standHeaders ? base.standHeaders(descriptor.headers || {}, true, false) : (descriptor.headers || {}),",
  "\t\t\t\treferrer: location.href,",
  "\t\t\t}))",
  "\t\t\t.filter(item => typeof item.url === \"string\" && /^https:\\/\\//.test(item.url));",
  "\t\tif (!items.length) throw new Error(\"未获取到可用直链，请确认已登录且文件可下载\");",
  "\t\tconst result = await GM_fluxdownDownload(items);",
  "\t\tif (result !== \"success\") throw new Error(\"FluxDown 未接收任务，请确认桌面端已启动\");",
  "\t\tfluxdownAutoClearPending();",
  "\t\ttry { Swal.close(); } catch { }",
  "\t\treturn items.length;",
  "\t}",
].join("\r\n");

const SRC_GENERIC_AUTO_TRIGGER = "\t\t\tconst fluxdownAuto = fluxdownParam || fluxdownPending || fluxdownBootAuto;";

const OUT_GENERIC_AUTO_TRIGGER = SRC_GENERIC_AUTO_TRIGGER + "\r\n\r\n" +
  "\t\t\tif (fluxdownAuto && [$quark, $uc, $guangya, $123pan].includes(temp.main)) {\r\n" +
  "\t\t\t\tmessage.info(\"FluxDown：正在提取直链…\");\r\n" +
  "\t\t\t\tsetTimeout(async () => {\r\n" +
  "\t\t\t\t\ttry {\r\n" +
  "\t\t\t\t\t\tconst count = await fluxdownAutoDownloadCurrent();\r\n" +
  "\t\t\t\t\t\tmessage.success(\"FluxDown：已自动加入 \" + count + \" 个下载任务\");\r\n" +
  "\t\t\t\t\t} catch (error) {\r\n" +
  "\t\t\t\t\t\ttry { sessionStorage.removeItem(\"fluxdown_auto_pending\"); } catch { }\r\n" +
  "\t\t\t\t\t\ttry { base.delValue(\"fluxdown_auto_share\"); } catch { }\r\n" +
  "\t\t\t\t\t\tconst safe = $(\"<div>\").text(String(error?.message || error)).html();\r\n" +
  "\t\t\t\t\t\tmessage.error(\"FluxDown 自动下载失败：<br/>\" + safe);\r\n" +
  "\t\t\t\t\t}\r\n" +
  "\t\t\t\t}, 1200);\r\n" +
  "\t\t\t}";

const AUTO_METHODS = "\t\tgetAutoShareFiles() {\r\n\t\t\tconst toArray = (x) => {\r\n\t\t\t\tif (x && typeof x === \"object\" && \"value\" in x) x = x.value;\r\n\t\t\t\treturn x ? Array.from(x) : [];\r\n\t\t\t};\r\n\t\t\tconst root = unsafeWindow.document.querySelector(\"#app\");\r\n\t\t\tconst listView = base.findVueComponent(\"ListView\", root);\r\n\t\t\tif (listView?.props?.files) return toArray(listView.props.files);\r\n\t\t\tconst shareHeader = base.findVueComponent(\"ShareHeader\", root);\r\n\t\t\tconst context = shareHeader?.props?.context;\r\n\t\t\tif (context?.pageKind === \"single\") return toArray(context.files);\r\n\t\t\tconst previewComp = base.findVueComponent([\"DocViewer\", \"FileInfoPreview\", \"PicturePreview\", \"AudioPreview\", \"VideoPreview\"], root);\r\n\t\t\tif (previewComp?.props?.file) return [previewComp.props.file];\r\n\t\t\treturn [];\r\n\t\t},\r\n\t\tasync autoDownloadToFluxDown() {\r\n\t\t\tconst deadline = Date.now() + 90000;\r\n\t\t\tlet selected = [];\r\n\t\t\twhile (Date.now() < deadline) {\r\n\t\t\t\tselected = this.getSelectedList();\r\n\t\t\t\tif (!selected.length) selected = this.getShareSelectedList();\r\n\t\t\t\tif (!selected.length) selected = this.getAutoShareFiles();\r\n\t\t\t\tselected = (selected || []).filter(item => item && !item.isdir);\r\n\t\t\t\tif (selected.length) break;\r\n\t\t\t\tawait base.sleep(1000);\r\n\t\t\t}\r\n\t\t\tif (!selected.length) throw new Error(\"未读取到分享文件；请确认提取码已通过，或先登录百度网盘\");\r\n\t\t\tconst token = base.getValue(\"baidu_access_token\") || await this.getToken().catch(() => \"\");\r\n\t\t\tif (!token) throw new Error(\"请先登录百度网盘，再重新拖动链接\");\r\n\t\t\tlet shareData = null;\r\n\t\t\tconst shareDeadline = Date.now() + 30000;\r\n\t\t\twhile (Date.now() < shareDeadline) {\r\n\t\t\t\tshareData = await this.getShareData();\r\n\t\t\t\tif (shareData?.share?.id && shareData?.share?.uk) break;\r\n\t\t\t\tawait base.sleep(800);\r\n\t\t\t}\r\n\t\t\tif (!shareData?.share?.id) throw new Error(\"分享页数据尚未就绪，请稍后重试\");\r\n\t\t\tconst sign = await base.get(config.$baidu.api.getShareSign + \"&surl=1\" + shareData.share.url + \"$bdstoken=\" + shareData.baidu.token + \"&logid=\" + base.encodeBase(shareData.baidu.id));\r\n\t\t\tif (sign?.data?.sign && sign?.data?.timestamp) {\r\n\t\t\t\tshareData.sign = sign.data.sign;\r\n\t\t\t\tshareData.timestamp = sign.data.timestamp;\r\n\t\t\t}\r\n\t\t\tconst extracted = await this.getShareFilesUrl(selected.map(item => ({ ...item })), shareData);\r\n\t\t\tconst items = extracted.filter(item => item && !item.isdir).map(item => {\r\n\t\t\t\tconst name = item.server_filename || item.filename || \"download\";\r\n\t\t\t\tlet link = item.dlink;\r\n\t\t\t\tif (typeof link === \"string\" && link.startsWith(\"http\")) {\r\n\t\t\t\t\tconst url = new URL(link);\r\n\t\t\t\t\turl.searchParams.set(\"access_token\", token);\r\n\t\t\t\t\tlink = url.href;\r\n\t\t\t\t}\r\n\t\t\t\treturn {\r\n\t\t\t\t\turl: link,\r\n\t\t\t\t\tfilename: name,\r\n\t\t\t\t\tsize: Number(item.size) || 0,\r\n\t\t\t\t\theaders: { \"User-Agent\": config.$baidu.api.ua.downloadLink },\r\n\t\t\t\t\treferrer: location.href\r\n\t\t\t\t};\r\n\t\t\t}).filter(item => typeof item.url === \"string\" && /^https:\\/\\//.test(item.url));\r\n\t\t\tif (!items.length) {\r\n\t\t\t\tconst reason = extracted.find(item => typeof item?.dlink === \"string\" && item.dlink)?.dlink;\r\n\t\t\t\tthrow new Error(typeof reason === \"string\" ? reason.replace(/<[^>]+>/g, \"\") : \"未获取到可用直链\");\r\n\t\t\t}\r\n\t\t\tconst result = await GM_fluxdownDownload(items);\r\n\t\t\tif (result !== \"success\") throw new Error(\"FluxDown 未接收任务，请确认桌面端已启动\");\r\n\t\t\treturn items.length;\r\n\t\t},";

const FLUXDOWN_BAIDU_TRANSFER_METHOD = [
  "\t\tasync fluxdownSaveShareFiles(items, sData, token) {",
  "\t\t\ttoken = token || base.getValue(\"baidu_access_token\") || \"\";",
  "\t\t\tif (!token) throw new Error(\"请先登录百度网盘后再下载\");",
  "\t\t\tconst folder = \"/FluxDown\";",
  "\t\t\tconst enc = encodeURIComponent;",
  "\t\t\tconst listFolder = () => base.get(config.$baidu.api.getFiles + \"&dir=\" + enc(folder) + \"&access_token=\" + enc(token), { \"User-Agent\": config.$baidu.api.ua.downloadLink });",
  "\t\t\tconst ensureFolder = async () => {",
  "\t\t\t\tconst current = await listFolder();",
  "\t\t\t\tif (current?.errno === 0) return current;",
  "\t\t\t\tconst createUrl = \"https://pan.baidu.com/api/create?a=commit&bdstoken=\" + enc(sData.baidu.token);",
  "\t\t\t\tconst created = await base.post(createUrl, new URLSearchParams({ path: folder, isdir: \"1\", block_list: \"[]\" }), { \"Content-Type\": \"application/x-www-form-urlencoded\" });",
  "\t\t\t\tif (created?.errno && created.errno !== -8) throw new Error(\"创建 FluxDown 目录失败：\" + (created.errmsg || created.errno));",
  "\t\t\t\treturn await listFolder();",
  "\t\t\t};",
  "\t\t\tlet listing = await ensureFolder();",
  "\t\t\tlet folderFiles = Array.isArray(listing?.list) ? listing.list : [];",
  "\t\t\tconst normalized = items.map(item => ({ ...item }));",
  "\t\t\tconst nameOf = item => item.server_filename || item.filename || \"download\";",
  "\t\t\tconst sizeOf = item => Number(item.size) || 0;",
  "\t\t\tconst matchSaved = item => folderFiles.find(file => {",
  "\t\t\t\tconst name = file.server_filename || file.filename || \"\";",
  "\t\t\t\tif (name !== nameOf(item)) return false;",
  "\t\t\t\tconst expected = sizeOf(item);",
  "\t\t\t\treturn expected > 0 ? Number(file.size) === expected : true;",
  "\t\t\t}) || null;",
  "\t\t\tconst pending = normalized.filter(item => !matchSaved(item));",
  "\t\t\tif (pending.length) {",
  "\t\t\t\tconst transferUrl = new URL(\"https://pan.baidu.com/share/transfer\");",
  "\t\t\t\ttransferUrl.searchParams.set(\"shareid\", String(sData.share.id));",
  "\t\t\t\ttransferUrl.searchParams.set(\"from\", String(sData.share.uk));",
  "\t\t\t\ttransferUrl.searchParams.set(\"bdstoken\", sData.baidu.token);",
  "\t\t\t\tif (sData.sekey) transferUrl.searchParams.set(\"sekey\", sData.sekey);",
  "\t\t\t\tif (sData.baidu.id) transferUrl.searchParams.set(\"logid\", base.encodeBase(sData.baidu.id));",
  "\t\t\t\tconst transfer = await base.post(transferUrl, new URLSearchParams({ fsidlist: JSON.stringify(pending.map(item => item.fs_id)), path: folder }), { \"Content-Type\": \"application/x-www-form-urlencoded\" });",
  "\t\t\t\tif (transfer?.errno !== 0 && transfer?.errno !== 4) throw new Error(\"保存分享文件到网盘失败：\" + (transfer?.errmsg || transfer?.errno || \"未知错误\"));",
  "\t\t\t\tconst pollDeadline = Date.now() + 15000;",
  "\t\t\t\tdo {",
  "\t\t\t\t\tawait base.sleep(1000);",
  "\t\t\t\t\tlisting = await listFolder();",
  "\t\t\t\t\tfolderFiles = Array.isArray(listing?.list) ? listing.list : [];",
  "\t\t\t\t} while (pending.some(item => !matchSaved(item)) && Date.now() < pollDeadline);",
  "\t\t\t}",
  "\t\t\tconst saved = normalized.map(item => ({ item, file: matchSaved(item) }));",
  "\t\t\tif (saved.some(entry => !entry.file)) throw new Error(\"文件保存后未出现在 /FluxDown 目录\");",
  "\t\t\tconst metaUrl = new URL(\"https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&dlink=1\");",
  "\t\t\tmetaUrl.searchParams.set(\"fsids\", JSON.stringify(saved.map(entry => entry.file.fs_id)));",
  "\t\t\tmetaUrl.searchParams.set(\"access_token\", token);",
  "\t\t\tconst meta = await base.get(metaUrl, { \"User-Agent\": config.$baidu.api.ua.downloadLink });",
  "\t\t\tif (meta?.errno !== 0 || !Array.isArray(meta.list)) throw new Error(\"读取网盘直链失败：\" + (meta?.errmsg || meta?.errno || \"未知错误\"));",
  "\t\t\tconst details = new Map(meta.list.map(file => [String(file.fs_id), file]));",
  "\t\t\treturn saved.map(({ item, file }) => {",
  "\t\t\t\tconst detail = details.get(String(file.fs_id));",
  "\t\t\t\tif (!detail?.dlink) throw new Error(\"网盘没有返回可用直链，请稍后重试\");",
  "\t\t\t\treturn { ...item, fs_id: file.fs_id, server_filename: file.server_filename || nameOf(item), size: Number(file.size) || Number(item.size) || 0, dlink: detail.dlink };",
  "\t\t\t});",
  "\t\t},",
].join("\r\n");

function patchLinkSwift(source) {
  let text = source;

  text = applyStringPatch(
    text,
    "methodConfig",
    SRC_METHOD_CONFIG,
    OUT_METHOD_CONFIG,
  );

  const menuPattern = /^([ \t]*)<(div|li) class="([^"]*\bpl-button-mode\b[^"]*)" data-mode="abdm"><svg class="pl-icon"><use xlink:href="#pl-icon-fa-cloud-arrow-down"\/><\/svg><span>ABDM 下载<\/span><\/\2>$/gm;
  const menuMatches = text.match(menuPattern) ?? [];
  if (menuMatches.length !== 15) {
    throw new Error("patch \"menuItems\": expected 15 abdm menu anchors, found " + menuMatches.length);
  }
  text = applyRegexPatch(
    text,
    "menuItems",
    menuPattern,
    (full, indentation, tagName, className) => full + "\r\n" + indentation + "<" + tagName + " class=\"" + className + "\" data-mode=\"fluxdown\"><svg class=\"pl-icon\"><use xlink:href=\"#pl-icon-fa-cloud-arrow-up\"/></svg><span>FluxDown 下载</span></" + tagName + ">",
    15,
  );

  text = applyStringPatch(text, "fileRows", SRC_FILE_ROW, OUT_FILE_ROW);
  text = applyStringPatch(text, "extraButtons", SRC_EXTRA, OUT_EXTRA);
  text = applyStringPatch(text, "sendtoSwitch", SRC_SENDTO_CASE, OUT_SENDTO_CASE);
  text = applyStringPatch(text, "sendToFluxDown", SRC_METHOD_ANCHOR, OUT_METHOD_ANCHOR);
  text = applyStringPatch(text, "consoleClear", SRC_CONSOLE_CLEAR, OUT_CONSOLE_CLEAR);
  text = applyStringPatch(text, "jQueryCall", SRC_GLOBAL_INVOCATION, OUT_GLOBAL_INVOCATION);
  text = applyStringPatch(text, "unsafeWindow", "if (typeof (unsafeWindow) === \"undefined\") window.unsafeWindow = window;", "const unsafeWindow = window;");
  text = applyInsertionPatch(text, "autoMethods", SRC_AUTO_METHOD_INSERT, AUTO_METHODS + "\r\n" + FLUXDOWN_BAIDU_TRANSFER_METHOD);
  text = applyRegexPatch(
    text,
    "baiduLargeFileFallback",
    /^([ \t]*)if \(base\.isType\(res\.list\) === "string"\) item\.dlink = .*$/m,
    (_full, indentation) => [
      indentation + "if (base.isType(res.list) === \"string\") {",
      indentation + "\tlet fluxdownFallback = null;",
      indentation + "\tlet fluxdownReason = \"\";",
      indentation + "\ttry {",
      indentation + "\t\tconst saved = await this.fluxdownSaveShareFiles([item], sData, base.getValue(\"baidu_access_token\"));",
      indentation + "\t\tfluxdownFallback = saved?.[0] || null;",
      indentation + "\t} catch (error) {",
      indentation + "\t\tfluxdownReason = String(error?.message || error || \"未知原因\");",
      indentation + "\t\tbase.console.warn(\"[FluxDown] 大文件转存直链失败：\", fluxdownReason);",
      indentation + "\t}",
      indentation + "\tif (fluxdownFallback) Object.assign(item, fluxdownFallback);",
      indentation + "\telse item.dlink = `获取下载地址失败：此文件超过直链获取限制，自动保存到 /FluxDown 再取直链未成功（${fluxdownReason}）。请确认已登录百度网盘，或先手动保存到网盘后重试。`;",
      indentation + "}",
    ].join("\r\n"),
    1,
  );
  text = applyStringPatch(
    text,
    "baiduLargeFileGlinksGuard",
    "\t\t\t\ttemp.glinks.push({ \"id\": item.fs_id, \"expires\": (Date.now() + 4 * 60 * 60 * 1000), \"data\": res.list[0] });",
    "\t\t\t\tif (base.isType(res.list) === \"array\") temp.glinks.push({ \"id\": item.fs_id, \"expires\": (Date.now() + 4 * 60 * 60 * 1000), \"data\": res.list[0] });",
  );
  text = applyStringPatch(text, "autoTrigger", SRC_AUTO_TRIGGER, OUT_AUTO_TRIGGER);
  text = applyStringPatch(
    text,
    "autoLoginFirst",
    "\t\t\tconst deadline = Date.now() + 90000;\r\n\t\t\tlet selected = [];",
    "\t\t\tlet token = base.getValue(\"baidu_access_token\") || \"\";\r\n" +
      "\t\t\tconst loginDeadline = Date.now() + 10 * 60 * 1000;\r\n" +
      "\t\t\tlet loginHinted = false;\r\n" +
      "\t\t\twhile (!token && Date.now() < loginDeadline) {\r\n" +
      "\t\t\t\ttoken = base.getValue(\"baidu_access_token\") || \"\";\r\n" +
      "\t\t\t\tif (!token && Number(unsafeWindow?.locals?.dump?.()?.loginstate?.value) > 0) {\r\n" +
      "\t\t\t\t\ttoken = await this.getToken().catch(() => \"\");\r\n" +
      "\t\t\t\t}\r\n" +
      "\t\t\t\tif (token) break;\r\n" +
      "\t\t\t\tif (!loginHinted) {\r\n" +
      "\t\t\t\t\tloginHinted = true;\r\n" +
      "\t\t\t\t\tmessage.info(\"FluxDown：请先登录百度网盘，登录后会自动继续下载\");\r\n" +
      "\t\t\t\t}\r\n" +
      "\t\t\t\tawait new Promise(resolve => {\r\n" +
      "\t\t\t\t\tconst timer = setTimeout(done, 30000);\r\n" +
      "\t\t\t\t\tfunction done() {\r\n" +
      "\t\t\t\t\t\tclearTimeout(timer);\r\n" +
      "\t\t\t\t\t\twindow.removeEventListener(\"focus\", done);\r\n" +
      "\t\t\t\t\t\tresolve();\r\n" +
      "\t\t\t\t\t}\r\n" +
      "\t\t\t\t\twindow.addEventListener(\"focus\", done, { once: true });\r\n" +
      "\t\t\t\t});\r\n" +
      "\t\t\t}\r\n" +
      "\t\t\tif (!token) throw new Error(\"等待百度网盘登录超时，请登录后重新拖动链接\");\r\n" +
      "\t\t\tmessage.info(\"FluxDown：登录已就绪，正在读取分享文件…\");\r\n" +
      "\t\t\tconst deadline = Date.now() + 90000;\r\n" +
      "\t\t\tlet selected = [];",
  );
  text = applyStringPatch(
    text,
    "autoProgress",
    "\t\t\tif (fluxdownAuto && temp.main === $baidu) {\r\n\t\t\t\ttry {",
    "\t\t\tif (fluxdownAuto && temp.main === $baidu) {\r\n\t\t\t\tmessage.info(\"FluxDown：正在提取直链…\");\r\n\t\t\t\ttry {",
  );
  text = applyStringPatch(
    text,
    "autoWait",
    "const deadline = Date.now() + 90000;",
    "const deadline = Date.now() + 45000;",
  );
  text = applyStringPatch(
    text,
    "autoFlag",
    "const fluxdownAuto = new URL(location.href).searchParams.get(\"fluxdown_auto\") === \"1\";",
    "const fluxdownParam = new URL(location.href).searchParams.get(\"fluxdown_auto\") === \"1\";\r\n\t\t\tconst fluxdownPending = (() => {\r\n\t\t\t\ttry { return sessionStorage.getItem(\"fluxdown_auto_pending\") === \"1\"; } catch { return false; }\r\n\t\t\t})();\r\n\t\t\tif (fluxdownParam) {\r\n\t\t\t\ttry { sessionStorage.setItem(\"fluxdown_auto_pending\", \"1\"); } catch { }\r\n\t\t\t}\r\n\t\t\tconst fluxdownBootAuto = (() => {\r\n\t\t\t\ttry { return base.getValue(\"fluxdown_auto_share\") === \"1\"; } catch { return false; }\r\n\t\t\t})();\r\n\t\t\tconst fluxdownAuto = fluxdownParam || fluxdownPending || fluxdownBootAuto;",
  );
  text = applyStringPatch(
    text,
    "autoKeepParam",
    "\t\t\t\ttry {\r\n\t\t\t\t\tconst clean = new URL(location.href);\r\n\t\t\t\t\tclean.searchParams.delete(\"fluxdown_auto\");\r\n\t\t\t\t\thistory.replaceState(history.state, \"\", clean.href);\r\n\t\t\t\t} catch { }\r\n",
    "",
  );
  text = applyStringPatch(
    text,
    "autoLoginWaitRemove",
    "\t\t\tconst token = base.getValue(\"baidu_access_token\") || await this.getToken().catch(() => \"\");\r\n\t\t\tif (!token) throw new Error(\"请先登录百度网盘，再重新拖动链接\");",
    "\t\t\t// token 已在等待文件列表前获取。",
  );
  text = applyStringPatch(
    text,
    "autoSuccessCleanup",
    "\t\t\tconst result = await GM_fluxdownDownload(items);\r\n\t\t\tif (result !== \"success\") throw new Error(\"FluxDown 未接收任务，请确认桌面端已启动\");\r\n\t\t\treturn items.length;",
    "\t\t\tconst result = await GM_fluxdownDownload(items);\r\n\t\t\tif (result !== \"success\") throw new Error(\"FluxDown 未接收任务，请确认桌面端已启动\");\r\n\t\t\ttry { sessionStorage.removeItem(\"fluxdown_auto_pending\"); } catch { }\r\n\t\t\ttry { base.delValue(\"fluxdown_auto_share\"); } catch { }\r\n\t\t\ttry {\r\n\t\t\t\tconst done = new URL(location.href);\r\n\t\t\t\tdone.searchParams.delete(\"fluxdown_auto\");\r\n\t\t\t\thistory.replaceState(history.state, \"\", done.href);\r\n\t\t\t} catch { }\r\n\t\t\treturn items.length;",
  );
  text = applyInsertionPatch(text, "autoGenericMethods", SRC_GENERIC_AUTO_ANCHOR, GENERIC_AUTO_METHOD);
  text = applyStringPatch(text, "autoGenericTrigger", SRC_GENERIC_AUTO_TRIGGER, OUT_GENERIC_AUTO_TRIGGER);

  assertAnchors(text, [
    ["fluxdown config", "fluxdown: {", 1],
    ["fluxdown menu items", "data-mode=\"fluxdown\"", 15],
    ["fluxdown file row", "\r\n\t\t\t\t\tif (temp.mode === \"fluxdown\") {\r\n", 1],
    ["fluxdown extra buttons", "\r\n\t\t\tif (temp.mode === \"fluxdown\") {\r\n", 1],
    ["fluxdown sendto case", "case \"fluxdown\":", 1],
    ["fluxdown send method", "async fluxdown(link, filename, filesize, headers = {}) {", 1],
    ["GM_fluxdownDownload call", "GM_fluxdownDownload(payload)", 1],
    ["local unsafeWindow", "const unsafeWindow = window;", 1],
    ["auto download method", "async autoDownloadToFluxDown() {", 1],
    ["auto trigger", "const fluxdownParam = new URL(location.href)", 1],
    ["auto token first", "const loginDeadline = Date.now() + 10 * 60 * 1000;", 1],
    ["auto login state", "loginstate?.value", 1],
  ]);

  const normalized = text.replace(/^\uFEFF/, "");
  return { patched: HEADER_COMMENT + normalized, wrapped: buildIsolatedBundle(normalized) };
}

function buildIsolatedBundle(patchedSource) {
  const windowScopes = ["jQuery", "$", "Swal", "Sweetalert2", "swal", "sweetAlert", "SweetAlert", "md5"];
  const dependencySources = LOCAL_DEPENDENCIES.slice(0, 3)
    .map(([sourceName]) => readFileSync(join(projectRoot, "vendor", "LinkSwift", sourceName), "utf8"));
  const lines = [
    "// Generated by scripts/patch-linkswift.mjs; wraps upstream LinkSwift with isolated local dependencies.\r\n",
    "(function fluxdownLinkSwiftIsolatedBundle() {\r\n",
    "  \"use strict\";\r\n",
    "  const saved = new Map();\r\n",
    "  const windowScopes = " + JSON.stringify(windowScopes) + ";\r\n",
    ...windowScopes.map((name) => "  saved.set(" + JSON.stringify(name) + ", Object.getOwnPropertyDescriptor(window, " + JSON.stringify(name) + "));\r\n"),
    "  let jQuery;\r\n",
    "  let $;\r\n",
    "  let Swal;\r\n",
    "  let md5;\r\n",
    "  try {\r\n",
    "    const localDependencies = loadLocalDependencies();\r\n",
    "    jQuery = localDependencies.jQuery;\r\n",
    "    $ = localDependencies.$;\r\n",
    "    Swal = localDependencies.Swal;\r\n",
    "    md5 = localDependencies.md5;\r\n",
    "  } finally {\r\n",
    ...windowScopes.map((name) => "    restore(" + JSON.stringify(name) + ");\r\n"),
    "  }\r\n",
    "  function loadLocalDependencies() {\r\n",
    "    loadUmdDependencies(undefined, undefined, undefined, undefined);\r\n",
    "    jQuery = window.jQuery;\r\n",
    "    $ = window.$;\r\n",
    "    Swal = typeof Sweetalert2 !== \"undefined\" ? Sweetalert2 : (window.Sweetalert2 || window.Swal || window.sweetAlert || window.SweetAlert);\r\n",
    "    md5 = window.md5;\r\n",
    "    if (typeof jQuery !== \"function\" || typeof $ !== \"function\" || typeof Swal !== \"function\" || typeof md5 !== \"function\") {\r\n",
    "      throw new Error(\"FluxDown Cloud: failed to capture local LinkSwift dependencies\");\r\n",
    "    }\r\n",
    "    if (jQuery.fn.jquery !== \"3.6.0\" || Swal.version !== \"11.4.8\") {\r\n",
    "      throw new Error(\"FluxDown Cloud: unexpected LinkSwift dependency versions\");\r\n",
    "    }\r\n",
    "    return { jQuery, $, Swal, md5 };\r\n",
    "  }\r\n",
    "  function loadUmdDependencies(module, exports, define, require) {\r\n",
    ...dependencySources.map((source) => "    " + source + "\r\n"),
    "    void module;\r\n",
    "    void exports;\r\n",
    "    void define;\r\n",
    "    void require;\r\n",
    "  }\r\n",
    "  function restore(name) {\r\n",
    "    const descriptor = saved.get(name);\r\n",
    "    if (descriptor) Object.defineProperty(window, name, descriptor);\r\n",
    "    else delete window[name];\r\n",
    "  }\r\n",
    "(function linkSwiftWithLocalDependencies(jQuery, $, Swal, md5) {\r\n",
    patchedSource,
    "\r\n})(jQuery, $, Swal, md5);\r\n",
    "})();\r\n",
  ];
  return lines.join("");
}

function copyLocalDependencies() {
  mkdirSync(vendorOutputDirectory, { recursive: true });
  for (const [sourceName, outputName] of LOCAL_DEPENDENCIES) {
    const source = join(projectRoot, "vendor", "LinkSwift", sourceName);
    const target = join(vendorOutputDirectory, outputName);
    if (!existsSync(source)) {
      throw new Error(`missing local dependency: ${sourceName}`);
    }
    copyFileSync(source, target);
  }
}

export function buildPatchedLinkSwift() {
  if (!existsSync(sourceFile)) {
    throw new Error("missing upstream source: " + sourceFile);
  }
  const source = readFileSync(sourceFile, "utf8");
  const built = patchLinkSwift(source);
  mkdirSync(outputDirectory, { recursive: true });
  copyLocalDependencies();
  writeFileSync(outputFile, built.patched, "utf8");
  writeFileSync(wrapperFile, built.wrapped, "utf8");
  return {
    sourceBytes: Buffer.byteLength(source, "utf8"),
    outputBytes: Buffer.byteLength(built.patched, "utf8"),
    wrapperBytes: Buffer.byteLength(built.wrapped, "utf8"),
    outputSha256: sha256(built.patched),
    wrapperSha256: sha256(built.wrapped),
    outputFile,
    wrapperFile,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = buildPatchedLinkSwift();
  console.log(
    `Patched LinkSwift: ${result.outputBytes} bytes, sha256=${result.outputSha256}, output=${result.outputFile}`,
  );
}
