const siteBaseUrl = "https://missav.ai";
const siteCandidates = [
  "https://missav.ai",
  "https://missav.ws",
  "https://missav.live",
  "https://missav.fans",
  "https://missav.media",
];
const userAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";
const channel = "MissAV";

const slugPattern = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const pagePattern = /[?&]page=([0-9]{1,7})/;
const mediaPattern = /https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*/g;
const packedPattern = /eval\(function\(p,a,c,k,e,d\)\{.*?\}\('((?:[^'\\]|\\.)*)',([0-9]+),([0-9]+),'((?:[^'\\]|\\.)*)'\.split\('\|'\)/gs;
const languageSegments = ["cn", "en", "ja", "ko", "ms", "th", "tw"];
const reservedSlugs = [
  "new", "release", "genres", "actresses", "makers", "search", "vip", "site", "playlists",
  "saved", "login", "logout", "register", "today-hot", "weekly-hot", "monthly-hot",
  "chinese-subtitle", "english-subtitle", "uncensored-leak", "vr", "articles", "about",
  "terms", "privacy", "dmca", "contact", "random", "ranking", "rankings", "actresses-ranking",
];

function truncate(text, limit) {
  const trimmed = text.trim();
  const characters = Array.from(trimmed);
  return characters.length <= limit ? trimmed : characters.slice(0, limit).join("") + "...";
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") {
      return value.trim();
    }
  }
  return "";
}

function pad2(value) {
  return value < 10 ? "0" + value : String(value);
}

function normalizeDate(text) {
  const matches = String(text).trim().match(/\d{4}-\d{1,2}-\d{1,2}/g) || [];
  for (const match of matches) {
    const [year, month, day] = match.split("-").map((part) => parseInt(part, 10));
    if (year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return year + "-" + pad2(month) + "-" + pad2(day);
    }
  }
  return "";
}

function validDate(date) {
  const [year, month, day] = date.split("-").map((part) => parseInt(part, 10));
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function releaseDate(value) {
  value = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(value)) {
    const stamp = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
    if (!isNaN(stamp)) {
      const date = new Date(stamp + 8 * 3600 * 1000);
      value = date.getUTCFullYear() + "-" + pad2(date.getUTCMonth() + 1) + "-" + pad2(date.getUTCDate());
    }
  }
  const date = normalizeDate(value);
  return date !== "" && validDate(date) ? date : "";
}

function parseAddress(raw) {
  try {
    return host.parseUrl(raw);
  } catch (error) {
    return null;
  }
}

function htmlUnescape(text) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0" };
  return text.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (entity, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    }
    return Object.prototype.hasOwnProperty.call(named, body) ? named[body] : entity;
  });
}

function resolveUrl(base, ref) {
  ref = htmlUnescape(String(ref || "")).trim();
  if (ref === "") {
    return "";
  }
  ref = ref.replace(/\\\//g, "/");
  if (ref.startsWith("//")) {
    return "https:" + ref;
  }
  const parsed = parseAddress(ref);
  if (!parsed) {
    return ref;
  }
  let resolved = parsed.href;
  if (parsed.scheme === "") {
    try {
      resolved = host.resolveUrl(base, ref);
    } catch (error) {
      return ref;
    }
  }
  return resolved.replace(/^http:/, "https:");
}

function pathEscape(text) {
  const kept = { "%24": "$", "%26": "&", "%2B": "+", "%2C": ",", "%3A": ":", "%3B": ";", "%3D": "=", "%40": "@" };
  return encodeURIComponent(text)
    .replace(/[!'()*]/g, (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%(?:24|26|2B|2C|3A|3B|3D|40)/g, (escaped) => kept[escaped]);
}

function decodeText(text) {
  try {
    return decodeURIComponent(text);
  } catch (error) {
    return text;
  }
}

function htmlTree(body) {
  if (body.length > 4 << 20) {
    throw new Error("站源页面过大");
  }
  const root = host.parseHtml(body);
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    for (const child of node.children || []) {
      child.parent = node;
      pending.push(child);
    }
  }
  return root;
}

function htmlNodes(root, match) {
  const found = [];
  if (!root) {
    return found;
  }
  const pending = [root];
  while (pending.length > 0) {
    const node = pending.pop();
    if (match(node)) {
      found.push(node);
    }
    const children = node.children || [];
    for (let index = children.length - 1; index >= 0; index--) {
      pending.push(children[index]);
    }
  }
  return found;
}

function htmlAttr(node, name) {
  return node && node.attrs && typeof node.attrs[name] === "string" ? node.attrs[name] : "";
}

function htmlClass(node, name) {
  return htmlAttr(node, "class").split(/\s+/).includes(name);
}

function htmlFirstClass(root, name) {
  return htmlNodes(root, (node) => htmlClass(node, name))[0] || null;
}

function htmlText(root) {
  const parts = [];
  for (const node of htmlNodes(root, (node) => node.tag === undefined && typeof node.text === "string")) {
    if (node.parent && (node.parent.tag === "script" || node.parent.tag === "style")) {
      continue;
    }
    parts.push(node.text);
  }
  return parts.join(" ").split(/\s+/).filter((part) => part !== "").join(" ");
}

function tagged(...names) {
  return (node) => names.includes(node.tag);
}

function validCategory(category) {
  if (category === "") {
    return true;
  }
  return category.length <= 96 && !/[/\\?#\x00\r\n]/.test(category);
}

function coverAddress(raw, base) {
  raw = String(raw || "").trim();
  if (raw === "" || raw.startsWith("data:")) {
    return "";
  }
  const parsed = parseAddress(resolveUrl(base || siteBaseUrl + "/", raw));
  if (!parsed || (parsed.scheme !== "https" && parsed.scheme !== "http") || parsed.hostname === "" || parsed.userInfo) {
    return "";
  }
  return parsed.href;
}

function contentSegments(href) {
  const parsed = parseAddress(String(href || "").trim());
  if (!parsed) {
    return [];
  }
  const segments = String(parsed.path || "").split("/").filter((segment) => segment !== "");
  if (segments.length > 0 && /^dm[0-9]+$/.test(segments[0])) {
    segments.shift();
  }
  if (segments.length > 0 && languageSegments.includes(segments[0].toLowerCase())) {
    segments.shift();
  }
  return segments;
}

function cardSlug(href) {
  const segments = contentSegments(href);
  if (segments.length !== 1) {
    return "";
  }
  const slug = segments[0].trim();
  if (!slugPattern.test(slug) || reservedSlugs.includes(slug.toLowerCase())) {
    return "";
  }
  return slug;
}

function genreSlug(href) {
  const segments = contentSegments(href);
  if (segments.length !== 2 || segments[0].toLowerCase() !== "genres") {
    return "";
  }
  return decodeText(segments[1]).trim();
}

function metadataOf(document) {
  const metadata = {};
  for (const node of htmlNodes(document, tagged("meta"))) {
    const key = firstNonEmpty(htmlAttr(node, "property"), htmlAttr(node, "name"));
    const value = htmlAttr(node, "content").trim();
    if (key !== "" && value !== "" && !metadata[key]) {
      metadata[key] = value;
    }
  }
  return metadata;
}

function heading(document) {
  for (const node of htmlNodes(document, tagged("h1"))) {
    const text = htmlText(node);
    if (text !== "") {
      return text;
    }
  }
  return "";
}

function poster(document) {
  for (const node of htmlNodes(document, tagged("video"))) {
    const value = htmlAttr(node, "data-poster");
    if (value !== "") {
      return value;
    }
  }
  return "";
}

function cardImage(card) {
  let fallback = null;
  for (const image of htmlNodes(card, tagged("img"))) {
    const source = htmlAttr(image, "data-src");
    if (source !== "" && !source.startsWith("data:")) {
      return image;
    }
    if (fallback === null) {
      const plain = htmlAttr(image, "src");
      if (plain !== "" && !plain.startsWith("data:")) {
        fallback = image;
      }
    }
  }
  return fallback;
}

function parseCards(document, base) {
  const cards = htmlNodes(document, (node) => node.tag === "div" && htmlClass(node, "thumbnail") && htmlClass(node, "group"));
  const items = [];
  const seen = new Set();
  for (const card of cards) {
    if (items.length >= 500) {
      break;
    }
    let slug = "";
    for (const anchor of htmlNodes(card, tagged("a"))) {
      slug = cardSlug(htmlAttr(anchor, "href"));
      if (slug !== "") {
        break;
      }
    }
    if (slug === "" || seen.has(slug)) {
      continue;
    }
    const image = cardImage(card);
    let title = htmlText(htmlFirstClass(card, "my-2"));
    if (title === "" && image !== null) {
      title = htmlAttr(image, "alt").trim();
    }
    if (title === "") {
      title = slug.toUpperCase();
    }
    if (image === null && title === slug.toUpperCase()) {
      continue;
    }
    const cover = image === null ? "" : coverAddress(firstNonEmpty(htmlAttr(image, "data-src"), htmlAttr(image, "src")), base);
    const badge = htmlNodes(card, (node) => node.tag === "span" && htmlClass(node, "absolute") && (htmlClass(node, "bottom-1") || htmlClass(node, "left-1")))[0];
    seen.add(slug);
    items.push({
      id: host.dramaId(slug),
      source: host.source,
      sourceId: slug,
      title: truncate(title, 512),
      name: truncate(title, 512),
      cover,
      coverUrl: cover,
      channelName: channel,
      categoryName: "视频",
      remark: truncate(badge ? htmlText(badge) : "", 32),
    });
  }
  return items;
}

function hasMorePages(document, page) {
  let maxPage = 0;
  for (const anchor of htmlNodes(document, tagged("a"))) {
    const match = htmlAttr(anchor, "href").match(pagePattern);
    if (match) {
      maxPage = Math.max(maxPage, parseInt(match[1], 10));
    }
    if (htmlAttr(anchor, "rel") === "next") {
      return true;
    }
  }
  return maxPage > page;
}

function tagsOf(document) {
  const tags = [];
  for (const anchor of htmlNodes(document, tagged("a"))) {
    if (genreSlug(htmlAttr(anchor, "href")) === "") {
      continue;
    }
    const text = htmlText(anchor);
    if (text === "" || tags.includes(text) || Array.from(text).length > 48) {
      continue;
    }
    tags.push(text);
    if (tags.length >= 16) {
      break;
    }
  }
  return tags;
}

function digit(value) {
  if (value > 35) {
    return String.fromCharCode(value + 29);
  }
  if (value < 10) {
    return String.fromCharCode(48 + value);
  }
  return String.fromCharCode(97 + value - 10);
}

function symbol(index, radix) {
  return index < radix ? digit(index) : symbol(Math.floor(index / radix), radix) + digit(index % radix);
}

function unpack(match) {
  const radix = parseInt(match[2], 10);
  const count = parseInt(match[3], 10);
  if (!(radix >= 2 && radix <= 64) || !(count >= 1 && count <= 2048)) {
    return "";
  }
  let payload = match[1].replace(/\\'/g, "'").replace(/\\\\/g, "\\");
  const words = match[4].split("|");
  for (let index = count - 1; index >= 0; index--) {
    if (index >= words.length || words[index] === "") {
      continue;
    }
    const pattern = new RegExp("\\b" + symbol(index, radix) + "\\b", "g");
    payload = payload.replace(pattern, () => words[index]);
  }
  return payload;
}

function mediaScore(address) {
  let score = /surrit\.com/i.test(address) ? 100000 : 0;
  if (/\/playlist\.m3u8(?:[?#]|$)/i.test(address)) {
    score += 10000;
  }
  const quality = address.match(/\/(\d{3,4})p\//);
  return score + (quality ? parseInt(quality[1], 10) : 1);
}

function mediaCandidates(body) {
  body = String(body || "");
  const found = [];
  const add = (raw) => {
    const address = String(raw || "").replace(/\\\//g, "/").trim();
    if (address !== "" && found.indexOf(address) < 0) {
      found.push(address);
    }
  };
  for (const address of body.match(mediaPattern) || []) {
    add(address);
  }
  for (const match of body.matchAll(packedPattern)) {
    for (const address of unpack(match).match(mediaPattern) || []) {
      add(address);
    }
  }
  if (found.length === 0) {
    const uuid = body.match(/surrit\.com\\?\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
    if (uuid) {
      add("https://surrit.com/" + uuid[1] + "/playlist.m3u8");
    }
  }
  return found.sort((left, right) => mediaScore(right) - mediaScore(left));
}

function rememberSite(base) {
  try {
    if (host.loadState("site") !== base) {
      host.saveState("site", base);
    }
  } catch (error) {
  }
}

function siteBases() {
  let remembered = "";
  try {
    remembered = String(host.loadState("site") || "").trim();
  } catch (error) {
    remembered = "";
  }
  const bases = [];
  if (siteCandidates.includes(remembered)) {
    bases.push(remembered);
  }
  for (const base of siteCandidates) {
    if (!bases.includes(base)) {
      bases.push(base);
    }
  }
  return bases;
}

function challengePage(body) {
  const head = String(body || "").slice(0, 4096).toLowerCase();
  return head.includes("just a moment") || head.includes("cf-chl") || head.includes("challenge-platform") ||
    head.includes("attention required") || head.includes("请稍候") || head.includes("檢查您的瀏覽器");
}

function fetchPage(paths, accept) {
  const bases = siteBases();
  let lastError = null;
  for (const base of bases) {
    for (const path of paths) {
      let response;
      try {
        response = host.fetchText({ url: base + path, referer: base + "/", userAgent });
      } catch (error) {
        lastError = error;
        const status = Number(error && error.status) || 0;
        if (status >= 400 && status < 500 && status !== 429) {
          continue;
        }
        break;
      }
      const body = String((response && response.body) || "");
      if (body.trim() === "" || challengePage(body) || (accept && !accept(body))) {
        lastError = new Error("MissAV 页面内容异常，请稍后重试或更换网络");
        continue;
      }
      rememberSite(base);
      return { base, url: base + path, body };
    }
  }
  throw lastError || new Error("MissAV 无法连接");
}

function fetchCatalogPage(page, category, query) {
  if (page < 1 || page > 1000000 || query.length > 256 || !validCategory(category)) {
    throw new Error("MissAV 目录查询参数无效");
  }
  const suffix = "?page=" + page;
  let paths;
  if (query !== "") {
    const escaped = pathEscape(query);
    paths = ["/cn/search/" + escaped + suffix, "/search/" + escaped + suffix];
  } else if (category !== "") {
    const escaped = pathEscape(category);
    paths = ["/cn/genres/" + escaped + suffix, "/genres/" + escaped + suffix];
  } else {
    paths = ["/cn/new" + suffix, "/new" + suffix, "/" + suffix];
  }
  let lastError = null;
  let emptyPage = false;
  for (const path of paths) {
    let pageResult;
    try {
      pageResult = fetchPage([path], (body) => body.includes("thumbnail"));
    } catch (error) {
      lastError = error;
      continue;
    }
    const document = htmlTree(pageResult.body);
    const items = parseCards(document, pageResult.base);
    if (items.length > 0) {
      return { items, hasMore: hasMorePages(document, page) };
    }
    emptyPage = true;
  }
  if (emptyPage) {
    if (page === 1 && query === "" && category === "") {
      throw new Error("MissAV 未返回应有的目录页，请重试");
    }
    return { items: [], hasMore: false };
  }
  throw lastError || new Error("MissAV 无法连接");
}

module.exports = {
  validCategory,

  categories() {
    const pageResult = fetchPage(["/cn/genres", "/genres"], (body) => body.includes("genres"));
    const document = htmlTree(pageResult.body);
    const order = [];
    const names = {};
    for (const anchor of htmlNodes(document, tagged("a"))) {
      const slug = genreSlug(htmlAttr(anchor, "href"));
      if (slug === "" || !validCategory(slug)) {
        continue;
      }
      const name = htmlText(anchor);
      if (name === "") {
        continue;
      }
      if (!Object.prototype.hasOwnProperty.call(names, slug)) {
        names[slug] = name;
        order.push(slug);
      } else if (Array.from(name).length < Array.from(names[slug]).length) {
        names[slug] = name;
      }
    }
    return order.slice(0, 200).map((slug) => ({ id: slug, name: truncate(names[slug], 48) }));
  },

  catalogPage(page, category) {
    return fetchCatalogPage(page, category, "");
  },

  search(page, query) {
    query = query.trim();
    if (query === "" || query.length > 256) {
      throw new Error("MissAV 搜索关键词无效");
    }
    return fetchCatalogPage(page, "", query);
  },

  detail(sourceId) {
    if (!slugPattern.test(sourceId)) {
      throw new Error("MissAV 视频 ID 无效");
    }
    const pageResult = fetchPage(["/cn/" + sourceId, "/" + sourceId], (body) => body.includes("og:title") || body.includes("og:image"));
    const document = htmlTree(pageResult.body);
    const metadata = metadataOf(document);
    const title = firstNonEmpty(heading(document), metadata["og:title"], metadata["twitter:title"]);
    if (title === "") {
      throw new Error("MissAV 详情缺少视频标题");
    }
    const description = firstNonEmpty(metadata["og:description"], metadata["description"]);
    const cover = coverAddress(firstNonEmpty(metadata["og:image"], metadata["twitter:image"], poster(document)), pageResult.base);
    const drama = {
      id: host.dramaId(sourceId),
      source: host.source,
      sourceId,
      title: truncate(title, 512),
      name: truncate(title, 512),
      desc: truncate(description, 12000),
      intro: truncate(description, 12000),
      cover,
      coverUrl: cover,
      channelName: channel,
      categoryName: "视频",
      onlineDate: releaseDate(metadata["og:video:release_date"]),
      tags: tagsOf(document),
      totalEpisode: 1,
      episodeCount: 1,
    };
    const chapter = {
      id: host.chapterId(sourceId, sourceId),
      source: host.source,
      title: "正片",
      currentEpisode: 1,
      videoUrl: "missav-play://" + sourceId,
      pageUrl: pageResult.url,
      referer: pageResult.url,
    };
    return { drama, chapters: [chapter] };
  },

  resolveMedia(task) {
    const dramaPrefix = host.source + ":";
    const sourceId = String(task.dramaId || "").startsWith(dramaPrefix) ? task.dramaId.slice(dramaPrefix.length).trim() : "";
    if (!slugPattern.test(sourceId) || !String((task.chapter && task.chapter.id) || "").startsWith(host.chapterId(sourceId, ""))) {
      throw new Error("MissAV 播放分集信息无效，请刷新详情");
    }
    const pageResult = fetchPage(["/cn/" + sourceId, "/" + sourceId], (body) => body.includes("surrit") || body.includes(".m3u8"));
    const candidates = mediaCandidates(pageResult.body);
    if (candidates.length === 0) {
      throw new Error("MissAV 页面里未解析到播放地址");
    }
    let lastError = null;
    for (const address of candidates) {
      try {
        return host.prepareWebMedia({ url: address, referer: pageResult.url }, channel);
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("MissAV 播放地址不可用，请重试");
  },
};
