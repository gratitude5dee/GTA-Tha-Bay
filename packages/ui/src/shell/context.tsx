import { createContext, type ComponentChildren } from 'preact';
import { useContext } from 'preact/hooks';
import { hrefFor } from './registry.ts';
import type { PageId, ShellApi, ShellContext } from './types.ts';

/** What every page reads: the shell API (navigate, modal, toast) and the shell context (ports, view models, prefs). */
export interface ShellBundle { shell: ShellApi; ctx: ShellContext }

const Ctx = createContext<ShellBundle | null>(null);

export function ShellProvider(props: { value: ShellBundle; children: ComponentChildren }) {
  return <Ctx.Provider value={props.value}>{props.children}</Ctx.Provider>;
}

export function useShell(): ShellBundle {
  const v = useContext(Ctx);
  if (!v) throw new Error('useShell outside ShellProvider');
  return v;
}

/** An in-shell link: a real `<a href>` (middle-click and copy work) that navigates through the shell on a plain click. */
export function Link(props: { to: PageId; params?: Record<string, string>; class?: string; testId?: string; children: ComponentChildren }) {
  const { shell } = useShell();
  const href = hrefFor(props.to, props.params);
  return (
    <a
      class={props.class ?? 'dv-link'}
      href={href}
      data-testid={props.testId}
      data-fid={`link.${props.to}${props.params ? `.${Object.values(props.params).join('.')}` : ''}`}
      onClick={(e) => {
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        shell.navigate(props.to, props.params);
      }}
    >
      {props.children}
    </a>
  );
}
