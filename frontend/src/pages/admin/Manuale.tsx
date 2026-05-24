/**
 * Manuale — renderizza docs/manuale-admin.md con react-markdown + remark-gfm.
 *
 * Fetch strategy:
 *   1. Prima tenta GET /api/docs/manuale-admin.md (se il backend serve file statici)
 *   2. In caso di 404/errore, tenta fetch('/docs/manuale-admin.md') (file statico Vite)
 *
 * TOC: costruito da h2/h3 nell'HTML renderizzato tramite rehypeSlug (autoId).
 * Stampa: window.print() con CSS @media print inline.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { Printer, RefreshCw, BookOpen, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchManuale(): Promise<string> {
  // Try backend first
  const attempts = ['/api/docs/manuale-admin.md', '/docs/manuale-admin.md'];
  let lastErr: Error | null = null;
  for (const url of attempts) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.status === 404) continue;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.trim()) return text;
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error('Manuale non trovato');
}

// ─── Print styles (injected as a <style> tag) ─────────────────────────────────

const PRINT_STYLES = `
@media print {
  @page { size: A4; margin: 2cm; }
  body * { visibility: hidden; }
  #manuale-print-area, #manuale-print-area * { visibility: visible; }
  #manuale-print-area {
    position: absolute; left: 0; top: 0; width: 100%;
    font-size: 11pt; line-height: 1.5; color: #000;
  }
  .manuale-no-print { display: none !important; }
}
`;

// ─── TOC ──────────────────────────────────────────────────────────────────────

interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

function buildToc(containerEl: HTMLElement): TocItem[] {
  const items: TocItem[] = [];
  containerEl.querySelectorAll<HTMLHeadingElement>('h2, h3').forEach((h) => {
    if (!h.id) return;
    items.push({
      id: h.id,
      text: h.textContent?.trim() ?? '',
      level: h.tagName === 'H2' ? 2 : 3,
    });
  });
  return items;
}

// ─── MarkdownContent ─────────────────────────────────────────────────────────

interface MdContentProps {
  markdown: string;
  onMounted: (el: HTMLDivElement) => void;
}

function MdContent({ markdown, onMounted }: MdContentProps) {
  return (
    <div
      ref={(el) => { if (el) onMounted(el); }}
      id="manuale-print-area"
      className="prose prose-slate dark:prose-invert max-w-none bg-card rounded-xl border border-border p-8 shadow-sm"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSlug]}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}

// ─── TOC Sidebar ─────────────────────────────────────────────────────────────

interface TocSidebarProps {
  items: TocItem[];
  active: string | null;
}

function TocSidebar({ items, active }: TocSidebarProps) {
  const { t } = useTranslation();

  if (items.length === 0) return null;

  function scrollTo(id: string) {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  return (
    <aside className="manuale-no-print sticky top-20 max-h-[calc(100vh-6rem)] overflow-y-auto rounded-xl border border-border bg-card p-4 text-sm">
      <h4 className="mb-3 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {t('admin.manuale.toc')}
      </h4>
      <ul className="list-none space-y-0 p-0">
        {items.map((it) => (
          <li key={it.id} className="m-0 p-0">
            <button
              onClick={() => scrollTo(it.id)}
              className={[
                'block w-full border-l-2 py-1.5 text-left leading-snug transition-colors',
                it.level === 3 ? 'pl-5 text-xs text-muted-foreground' : 'pl-3 text-sm',
                active === it.id
                  ? 'border-primary bg-primary/5 font-semibold text-primary'
                  : 'border-transparent text-foreground/70 hover:border-border hover:bg-muted hover:text-foreground',
              ].join(' ')}
            >
              {it.text}
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────

export default function AdminManuale() {
  const { t } = useTranslation();
  const [tocItems, setTocItems] = useState<TocItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const {
    data: markdown,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ['manuale'],
    queryFn: fetchManuale,
    staleTime: 5 * 60_000,
    retry: 1,
  });

  function onArticleMounted(el: HTMLDivElement) {
    // Build TOC
    const items = buildToc(el);
    setTocItems(items);

    // IntersectionObserver for active link
    if (!('IntersectionObserver' in window) || items.length === 0) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          if (en.isIntersecting) {
            setActiveId(en.target.id);
            break;
          }
        }
      },
      { rootMargin: '-20% 0px -70% 0px', threshold: 0 },
    );
    el.querySelectorAll<HTMLHeadingElement>('h2, h3').forEach((h) => io.observe(h));
    // No cleanup needed here as the component lifetime handles it
  }

  return (
    <>
      <style>{PRINT_STYLES}</style>

      <section className="mx-auto max-w-7xl space-y-6">
        {/* Header */}
        <header className="manuale-no-print">
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {t('admin.manuale.eyebrow')}
          </p>
          <h1 className="mt-1 text-2xl font-bold text-foreground">{t('admin.manuale.title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('admin.manuale.subtitle')}</p>
        </header>

        {/* Toolbar */}
        <div className="manuale-no-print flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card px-4 py-3">
          <Button
            size="sm"
            onClick={() => window.print()}
          >
            <Printer className="mr-1.5 h-3.5 w-3.5" />
            {t('admin.manuale.print')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void refetch()}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            {t('admin.manuale.reload')}
          </Button>
          <div className="ml-auto" />
          <Button variant="ghost" size="sm" asChild>
            <a href="/docs/manuale-admin.md" target="_blank" rel="noopener noreferrer">
              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
              {t('admin.manuale.open_raw')}
            </a>
          </Button>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-4 rounded-xl border border-border bg-card p-8">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-6 w-1/2 mt-4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6">
            <p className="font-mono text-[11px] font-bold uppercase tracking-wider text-destructive">
              {t('admin.manuale.error.title')}
            </p>
            <p className="mt-2 text-sm text-destructive/80">
              {error instanceof Error ? error.message : String(error)}
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              {t('admin.manuale.error.path')}: <code>/docs/manuale-admin.md</code>
            </p>
          </div>
        ) : !markdown ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-border p-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/5 text-primary">
              <BookOpen className="h-7 w-7" />
            </div>
            <h2 className="text-xl font-bold text-foreground">{t('admin.manuale.empty.title')}</h2>
            <p
              className="max-w-md text-sm text-muted-foreground"
              dangerouslySetInnerHTML={{ __html: t('admin.manuale.empty.desc') }}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
            {/* TOC */}
            <TocSidebar items={tocItems} active={activeId} />

            {/* Article */}
            <MdContent markdown={markdown} onMounted={onArticleMounted} />
          </div>
        )}
      </section>
    </>
  );
}
