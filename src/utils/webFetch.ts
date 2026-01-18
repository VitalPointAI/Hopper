/**
 * Web documentation fetching utilities for discovery-phase command
 *
 * Provides functions to fetch and parse documentation from common sources:
 * - npm package pages
 * - GitHub README and docs
 * - MDN Web Docs
 * - Official documentation sites
 */

/**
 * Parsed documentation result
 */
export interface DocResult {
  url: string;
  title: string;
  content: string;
  version?: string;
  lastUpdated?: string;
  source: 'npm' | 'github' | 'mdn' | 'official' | 'unknown';
  success: boolean;
  error?: string;
}

/**
 * Common documentation URL patterns
 */
const DOC_PATTERNS = {
  npm: /^https?:\/\/(www\.)?npmjs\.com\/package\//,
  github: /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/,
  mdn: /^https?:\/\/developer\.mozilla\.org\//,
  reactDocs: /^https?:\/\/(www\.)?react\.dev\//,
  nodeDocs: /^https?:\/\/nodejs\.org\/docs\//,
  typescriptDocs: /^https?:\/\/(www\.)?typescriptlang\.org\/docs\//
};

/**
 * Identify the documentation source from a URL
 */
export function identifySource(url: string): DocResult['source'] {
  if (DOC_PATTERNS.npm.test(url)) return 'npm';
  if (DOC_PATTERNS.github.test(url)) return 'github';
  if (DOC_PATTERNS.mdn.test(url)) return 'mdn';
  if (DOC_PATTERNS.reactDocs.test(url)) return 'official';
  if (DOC_PATTERNS.nodeDocs.test(url)) return 'official';
  if (DOC_PATTERNS.typescriptDocs.test(url)) return 'official';
  return 'unknown';
}

/**
 * Strip HTML tags and extract text content
 */
function stripHtml(html: string): string {
  // Remove script and style elements
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // Decode common HTML entities
  text = text.replace(/&nbsp;/g, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");

  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}

/**
 * Extract relevant content from npm package page
 */
function parseNpmPage(html: string, url: string): DocResult {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(' - npm', '').trim() : 'Unknown Package';

  // Extract version from page
  const versionMatch = html.match(/"version"\s*:\s*"([^"]+)"/);
  const version = versionMatch ? versionMatch[1] : undefined;

  // Extract README content
  const readmeMatch = html.match(/<div[^>]*id="readme"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/i);
  let content = '';

  if (readmeMatch) {
    content = stripHtml(readmeMatch[1]);
  } else {
    // Fallback: try to get description
    const descMatch = html.match(/<p[^>]*class="[^"]*package-description[^"]*"[^>]*>([^<]+)<\/p>/i);
    content = descMatch ? descMatch[1] : stripHtml(html).slice(0, 2000);
  }

  return {
    url,
    title,
    content: content.slice(0, 5000),
    version,
    source: 'npm',
    success: true
  };
}

/**
 * Extract relevant content from GitHub repository
 */
function parseGitHubPage(html: string, url: string): DocResult {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(' · GitHub', '').trim() : 'Unknown Repository';

  // Extract README content
  const readmeMatch = html.match(/<article[^>]*class="[^"]*markdown-body[^"]*"[^>]*>([\s\S]*?)<\/article>/i);
  let content = '';

  if (readmeMatch) {
    content = stripHtml(readmeMatch[1]);
  } else {
    // Fallback: get about description
    const aboutMatch = html.match(/<p[^>]*class="[^"]*f4[^"]*"[^>]*>([^<]+)<\/p>/i);
    content = aboutMatch ? aboutMatch[1] : stripHtml(html).slice(0, 2000);
  }

  return {
    url,
    title,
    content: content.slice(0, 5000),
    source: 'github',
    success: true
  };
}

/**
 * Extract relevant content from MDN Web Docs
 */
function parseMdnPage(html: string, url: string): DocResult {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(' - MDN Web Docs', '').trim() : 'MDN Documentation';

  // Extract main article content
  const articleMatch = html.match(/<article[^>]*class="[^"]*main-page-content[^"]*"[^>]*>([\s\S]*?)<\/article>/i);
  let content = '';

  if (articleMatch) {
    content = stripHtml(articleMatch[1]);
  } else {
    // Fallback
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    content = mainMatch ? stripHtml(mainMatch[1]) : stripHtml(html).slice(0, 2000);
  }

  // Try to get last modified date
  const modifiedMatch = html.match(/<time[^>]*datetime="([^"]+)"[^>]*>/i);
  const lastUpdated = modifiedMatch ? modifiedMatch[1] : undefined;

  return {
    url,
    title,
    content: content.slice(0, 5000),
    lastUpdated,
    source: 'mdn',
    success: true
  };
}

/**
 * Generic HTML content extraction
 */
function parseGenericPage(html: string, url: string): DocResult {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : new URL(url).hostname;

  // Try common content selectors
  const contentSelectors = [
    /<main[^>]*>([\s\S]*?)<\/main>/i,
    /<article[^>]*>([\s\S]*?)<\/article>/i,
    /<div[^>]*id="content"[^>]*>([\s\S]*?)<\/div>/i,
    /<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i
  ];

  let content = '';
  for (const selector of contentSelectors) {
    const match = html.match(selector);
    if (match) {
      content = stripHtml(match[1]);
      break;
    }
  }

  if (!content) {
    // Fallback to body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    content = bodyMatch ? stripHtml(bodyMatch[1]) : stripHtml(html);
  }

  return {
    url,
    title,
    content: content.slice(0, 5000),
    source: 'unknown',
    success: true
  };
}

/**
 * Fetch and parse documentation from a URL
 *
 * Uses the native fetch API available in VSCode extensions.
 * Automatically detects the source type and applies appropriate parsing.
 */
export async function fetchDocumentation(url: string): Promise<DocResult> {
  try {
    // Validate URL
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return {
        url,
        title: 'Invalid URL',
        content: '',
        source: 'unknown',
        success: false,
        error: 'Only HTTP/HTTPS URLs are supported'
      };
    }

    // Fetch the page
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; HopperBot/1.0; +https://hopper.dev)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });

    if (!response.ok) {
      return {
        url,
        title: 'Fetch Error',
        content: '',
        source: identifySource(url),
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`
      };
    }

    const html = await response.text();

    // Parse based on source
    const source = identifySource(url);
    switch (source) {
      case 'npm':
        return parseNpmPage(html, url);
      case 'github':
        return parseGitHubPage(html, url);
      case 'mdn':
        return parseMdnPage(html, url);
      default:
        return parseGenericPage(html, url);
    }
  } catch (err) {
    return {
      url,
      title: 'Error',
      content: '',
      source: 'unknown',
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Construct common documentation URLs for a package/library
 */
export interface DocUrls {
  npm?: string;
  github?: string;
  docs?: string;
}

/**
 * Get common documentation URLs for a package name
 */
export function getPackageDocUrls(packageName: string): DocUrls {
  const npmUrl = `https://www.npmjs.com/package/${packageName}`;
  const githubUrl = `https://github.com/search?q=${encodeURIComponent(packageName)}&type=repositories`;

  return {
    npm: npmUrl,
    github: githubUrl
  };
}

/**
 * Construct search URL for a topic
 */
export function getSearchUrl(query: string, site?: string): string {
  const baseQuery = site ? `site:${site} ${query}` : query;
  return `https://www.google.com/search?q=${encodeURIComponent(baseQuery)}`;
}

/**
 * Common official documentation URLs
 */
export const OFFICIAL_DOCS: Record<string, string> = {
  'react': 'https://react.dev/reference/react',
  'vue': 'https://vuejs.org/guide/introduction.html',
  'angular': 'https://angular.dev/overview',
  'svelte': 'https://svelte.dev/docs/introduction',
  'next': 'https://nextjs.org/docs',
  'nuxt': 'https://nuxt.com/docs',
  'typescript': 'https://www.typescriptlang.org/docs/',
  'node': 'https://nodejs.org/docs/latest/api/',
  'deno': 'https://docs.deno.com/',
  'bun': 'https://bun.sh/docs',
  'prisma': 'https://www.prisma.io/docs',
  'drizzle': 'https://orm.drizzle.team/docs/overview',
  'tailwind': 'https://tailwindcss.com/docs',
  'shadcn': 'https://ui.shadcn.com/docs',
  'vscode': 'https://code.visualstudio.com/api',
  'electron': 'https://www.electronjs.org/docs/latest/'
};

/**
 * Get official docs URL for a known library
 */
export function getOfficialDocsUrl(library: string): string | undefined {
  const normalized = library.toLowerCase().replace(/[^a-z0-9]/g, '');
  return OFFICIAL_DOCS[normalized];
}

/**
 * Fetch multiple documentation sources in parallel
 */
export async function fetchMultipleDocs(urls: string[]): Promise<DocResult[]> {
  const results = await Promise.all(
    urls.map(url => fetchDocumentation(url))
  );
  return results;
}

/**
 * Extract code examples from documentation content
 */
export function extractCodeExamples(content: string): string[] {
  const examples: string[] = [];

  // Look for code blocks (backticks or pre tags)
  const codeBlockRegex = /```[\w]*\n([\s\S]*?)```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const code = match[1].trim();
    if (code.length > 20 && code.length < 2000) {
      examples.push(code);
    }
  }

  return examples.slice(0, 5); // Limit to 5 examples
}

/**
 * Summarize documentation content for inclusion in prompts
 */
export function summarizeDocContent(doc: DocResult, maxLength: number = 1000): string {
  if (!doc.success) {
    return `[Failed to fetch ${doc.url}: ${doc.error}]`;
  }

  let summary = `Source: ${doc.title} (${doc.source})\n`;
  summary += `URL: ${doc.url}\n`;

  if (doc.version) {
    summary += `Version: ${doc.version}\n`;
  }

  if (doc.lastUpdated) {
    summary += `Updated: ${doc.lastUpdated}\n`;
  }

  summary += '\n';

  const contentLimit = maxLength - summary.length;
  if (doc.content.length > contentLimit) {
    summary += doc.content.slice(0, contentLimit - 3) + '...';
  } else {
    summary += doc.content;
  }

  return summary;
}
