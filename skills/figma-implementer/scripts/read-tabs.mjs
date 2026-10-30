#!/usr/bin/env node
/**
 * Which open tab is the design, and which is the page to build: give it the URLs of the open tabs.
 *
 *   node scripts/read-tabs.mjs <url> [<url> ...]
 *
 * Prints JSON: `designs`, each Figma tab with its file key and the node the user selected (from
 * `node-id`, `1-2` read as `1:2`; a branch link's branch key is the file key); `pages`, each local
 * dev-server tab with its origin and route; and `questions`, what is ambiguous or missing, to ask the
 * user rather than guess. No questions means exactly one design with a node and one page.
 */
import { pathToFileURL } from 'node:url';

const LOCAL_HOST = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\]|::1|[\w-]+\.localhost|10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})$/i;

/** A Figma tab's file and selected node, or undefined for any other URL. */
export function readDesign(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!/(^|\.)figma\.com$/i.test(url.hostname)) return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  const kind = parts[0];
  if (!['design', 'file', 'proto', 'make', 'board', 'slides'].includes(kind) || !parts[1]) return undefined;
  const branch = parts[2] === 'branch' && parts[3] ? parts[3] : undefined;
  // searchParams has already decoded it: 12%3A345 reads as 12:345.
  const rawNode = url.searchParams.get('node-id') ?? undefined;
  const nodeId = rawNode ? rawNode.replace(/^(\d+)-(\d+)$/, '$1:$2') : undefined;
  return {
    url: raw,
    kind,
    fileKey: branch ?? parts[1],
    ...(branch ? { mainFileKey: parts[1] } : {}),
    ...(nodeId ? { nodeId } : {}),
  };
}

/** A local dev-server tab's origin and route, or undefined for any other URL. */
export function readPage(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (!/^https?:$/.test(url.protocol) || !LOCAL_HOST.test(url.hostname)) return undefined;
  return { url: raw, origin: url.origin, route: `${url.pathname}${url.search}` };
}

/** The design and the page among the open tabs, and what to ask about. */
export function readTabs(urls) {
  const designs = urls.map(readDesign).filter(Boolean);
  const pages = urls.map(readPage).filter(Boolean);
  const questions = [];
  const buildable = designs.filter((design) => design.kind === 'design' || design.kind === 'file' || design.kind === 'proto' || design.kind === 'make');
  if (designs.length === 0) questions.push('No Figma tab is open: open the design, or paste its link.');
  else if (buildable.length === 0) questions.push('The Figma tabs are not designs (a board or slides): open the design file.');
  else if (new Set(buildable.map((design) => `${design.fileKey}#${design.nodeId ?? ''}`)).size > 1) {
    questions.push('More than one Figma design is open: which one is to be built?');
  } else if (!buildable[0].nodeId && buildable[0].kind !== 'make') {
    questions.push('The Figma tab has no frame selected: select the frame to build, which puts it in the URL.');
  }
  if (pages.length === 0) questions.push('No localhost tab is open: start the dev server and open the page, or say which route to build.');
  else if (new Set(pages.map((page) => `${page.origin}${page.route}`)).size > 1) {
    questions.push('More than one localhost page is open: which one should match the design?');
  }
  return { designs, pages, questions };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.error('Usage: node scripts/read-tabs.mjs <url> [<url> ...]');
    process.exit(2);
  }
  console.log(JSON.stringify(readTabs(urls), null, 2));
}
