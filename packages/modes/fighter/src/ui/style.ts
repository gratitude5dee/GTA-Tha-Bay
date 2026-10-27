/**
 * Styles of the fighter UI. Injected once by the mount. Layout works from 390 px high landscape phones to desktop: the bars scale
 * with `vw`, buttons are 44 px or more, the Training panel is a narrow column that collapses to a chip on short screens. Colours come
 * from the shell tokens (`--dv-color-*`) with fallbacks; the HUD palette (`data-palette`) swaps the three meter colours and every
 * meter also differs by shape (bars, diamonds, squares, a hatch for Rattled), so colour is never the only cue (FX9).
 */
export const FIGHTER_CSS = `
.dvf{position:fixed;inset:0;z-index:12;pointer-events:none;font-family:var(--dv-font-text,system-ui,sans-serif);color:var(--dv-color-text,#f2f5fb);
 --dvf-hp:#3ddc97;--dvf-hp-low:#ff6b6b;--dvf-hype:#ffc83d;--dvf-comp:#5ab4ff;--dvf-rattle:#ff6b6b;--dvf-bg:rgba(8,14,28,.72);--dvf-line:rgba(255,255,255,.28)}
.dvf[data-palette=deutan]{--dvf-hp:#4aa3ff;--dvf-hp-low:#ffb000;--dvf-hype:#ffd23f;--dvf-comp:#c9a0ff;--dvf-rattle:#ffb000}
.dvf[data-palette=protan]{--dvf-hp:#4aa3ff;--dvf-hp-low:#ffe14d;--dvf-hype:#ffe14d;--dvf-comp:#a0d8ff;--dvf-rattle:#ffe14d}
.dvf[data-palette=tritan]{--dvf-hp:#2fd3c0;--dvf-hp-low:#ff5a7a;--dvf-hype:#ff9ab0;--dvf-comp:#7ae0d6;--dvf-rattle:#ff5a7a}
.dvf *{box-sizing:border-box}
.dvf-hud{position:absolute;inset:0}
.dvf-top{position:absolute;left:2vw;right:2vw;top:max(8px,env(safe-area-inset-top));display:flex;align-items:flex-start;gap:1.2vw}
.dvf-side{flex:1;min-width:0;display:grid;gap:3px}
.dvf-s1{text-align:right}.dvf-s1 .dvf-hpwrap{transform:scaleX(-1)}.dvf-s1 .dvf-hptext{transform:scaleX(-1)}
.dvf-name{font:700 clamp(12px,1.6vw,18px)/1.1 var(--dv-font-display,system-ui);letter-spacing:.04em;text-transform:uppercase;text-shadow:0 1px 3px #000}
.dvf-hpwrap{position:relative;height:clamp(14px,2.2vw,24px);background:var(--dvf-bg);border:2px solid var(--dvf-line);border-radius:4px;overflow:hidden}
.dvf-hp{height:100%;background:linear-gradient(180deg,var(--dvf-hp),color-mix(in srgb,var(--dvf-hp) 70%,#000));transition:width .12s linear}
.dvf-hp[data-low='1']{background:repeating-linear-gradient(135deg,var(--dvf-hp-low) 0 8px,color-mix(in srgb,var(--dvf-hp-low) 60%,#000) 8px 16px)}
.dvf-hptext{position:absolute;inset:0;display:flex;align-items:center;justify-content:flex-end;padding:0 6px;font:700 clamp(10px,1.2vw,14px)/1 var(--dv-font-mono,monospace);text-shadow:0 1px 2px #000}
.dvf-pips{display:flex;gap:4px}.dvf-s1 .dvf-pips{justify-content:flex-end}
.dvf-pip{width:clamp(9px,1.2vw,14px);height:clamp(9px,1.2vw,14px);border:2px solid var(--dvf-line);border-radius:50%;background:transparent}
.dvf-pip[data-on='1']{background:#fff;border-color:#fff}
.dvf-meters{display:flex;gap:10px;align-items:center}.dvf-s1 .dvf-meters{justify-content:flex-end;flex-direction:row-reverse}
.dvf-hype,.dvf-comp{display:flex;gap:3px}
.dvf-dia{width:clamp(10px,1.4vw,16px);height:clamp(10px,1.4vw,16px);border:2px solid var(--dvf-hype);transform:rotate(45deg);background:linear-gradient(0deg,var(--dvf-hype) calc(var(--fill,0)*100%),transparent 0)}
.dvf-sq{width:clamp(8px,1.1vw,13px);height:clamp(8px,1.1vw,13px);border:2px solid var(--dvf-comp);background:linear-gradient(90deg,var(--dvf-comp) calc(var(--fill,0)*100%),transparent 0)}
.dvf-comp[data-rattled='1'] .dvf-sq{border-color:var(--dvf-rattle);background:repeating-linear-gradient(45deg,var(--dvf-rattle) 0 3px,transparent 3px 6px)}
.dvf-tag{min-height:1em;font:700 clamp(10px,1.2vw,13px)/1 var(--dv-font-text,system-ui);color:var(--dvf-rattle);letter-spacing:.06em;text-transform:uppercase}
.dvf-timer{flex:0 0 auto;min-width:clamp(48px,6vw,76px);text-align:center;font:800 clamp(22px,3.6vw,44px)/1 var(--dv-font-display,system-ui);text-shadow:0 2px 6px #000;padding-top:2px}
.dvf-combo{position:absolute;top:22%;font:800 clamp(16px,3vw,34px)/1.1 var(--dv-font-display,system-ui);text-shadow:0 2px 6px #000;opacity:0;transition:opacity .1s}
.dvf-combo[data-on='1']{opacity:1}.dvf-c0{left:3vw}.dvf-c1{right:3vw;text-align:right}
.dvf-banner{position:absolute;left:0;right:0;top:34%;text-align:center;font:900 clamp(34px,9vw,110px)/1 var(--dv-font-display,system-ui);letter-spacing:.06em;text-transform:uppercase;text-shadow:0 4px 14px #000;opacity:0;transform:scale(.9);transition:opacity .15s,transform .15s}
.dvf-banner[data-on='1']{opacity:1;transform:scale(1)}
.dvf-inputs{position:absolute;left:2vw;bottom:max(80px,14vh);display:none;flex-direction:column;gap:2px;font:600 12px/1 var(--dv-font-mono,monospace);background:var(--dvf-bg);padding:6px 8px;border-radius:6px}
.dvf-inputs[data-on='1']{display:flex}
.dvf-in{display:flex;gap:8px;align-items:center}.dvf-dir{display:inline-grid;place-items:center;width:20px;height:20px;border:1px solid var(--dvf-line);border-radius:4px}
.dvf-age{opacity:.6;font-style:normal;margin-left:auto}
.dvf-dim{position:absolute;inset:0;background:#000;opacity:0;transition:opacity .05s;pointer-events:none}.dvf-dim[data-on='1']{opacity:.45}
.dvf-tools{position:absolute;top:max(8px,env(safe-area-inset-top));left:50%;transform:translateX(-50%);pointer-events:auto;display:none}
.dvf-menu{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}
.dvf-menu:not(:empty){background:rgba(5,9,20,.55);pointer-events:auto}
.dvf-card{pointer-events:auto;background:var(--dv-color-surface,#142040);border:2px solid var(--dvf-line);border-radius:var(--dv-radius-lg,16px);padding:clamp(10px,2vw,22px);width:min(94vw,760px);max-height:92vh;overflow:auto;display:grid;gap:10px;box-shadow:0 12px 48px rgba(0,0,0,.5)}
.dvf-card h2{margin:0;font:800 clamp(20px,3.2vw,32px)/1.1 var(--dv-font-display,system-ui);text-transform:uppercase;letter-spacing:.04em}
.dvf-card h3{margin:0 0 4px;font:700 14px/1.2 var(--dv-font-text,system-ui);color:var(--dv-color-text-muted,#aab4cc);text-transform:uppercase;letter-spacing:.06em}
.dvf-hub{width:min(94vw,420px)}
.dvf-btnx,.dvf-chip,.dvf-card-btn{pointer-events:auto;cursor:pointer;min-height:44px;padding:8px 16px;border-radius:var(--dv-radius-md,12px);border:2px solid var(--dvf-line);background:var(--dv-color-surface-raised,#1b2b54);color:inherit;font:700 15px/1.1 var(--dv-font-text,system-ui)}
.dvf-chip{min-height:40px;padding:6px 12px;font-size:13px}
.dvf-btnx:focus-visible,.dvf-chip:focus-visible,.dvf-card-btn:focus-visible{outline:3px solid var(--dv-color-focus,#7cc4ff);outline-offset:2px}
.dvf-btnx:hover,.dvf-chip:hover,.dvf-card-btn:hover{border-color:#fff}
.dvf [data-on='1'].dvf-chip,.dvf [data-on='1'].dvf-card-btn{background:var(--dv-color-accent,#ff7a3d);color:var(--dv-color-accent-contrast,#1a0c04);border-color:#fff}
.dvf-go{background:var(--dv-color-accent,#ff7a3d);color:var(--dv-color-accent-contrast,#1a0c04);border-color:#fff}
.dvf-ghost{background:transparent}
.dvf button:disabled{opacity:.45;cursor:not-allowed}
.dvf-cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dvf-fighters{display:grid;gap:6px}.dvf-card-btn{text-align:left;width:100%}
.dvf-opts{display:grid;gap:8px}.dvf-opt{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.dvf-optl{min-width:96px;color:var(--dv-color-text-muted,#aab4cc);font-size:12px;text-transform:uppercase;letter-spacing:.06em}
.dvf-actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap}.dvf-note{margin:0;color:var(--dv-color-text-muted,#aab4cc);font-size:13px}
.dvf-scroll{max-height:44vh;overflow:auto}.dvf-moves{width:100%;border-collapse:collapse;font-size:13px}.dvf-moves th{text-align:left;color:var(--dv-color-text-muted,#aab4cc);font-weight:600;padding:3px 6px}.dvf-moves td{padding:3px 6px;border-top:1px solid var(--dvf-line)}
.dvf-mono{font-family:var(--dv-font-mono,monospace)}
.dvf-train{position:absolute;right:max(8px,env(safe-area-inset-right));top:clamp(70px,16vh,120px);width:min(34vw,300px);background:var(--dvf-bg);border:2px solid var(--dvf-line);border-radius:12px;padding:8px;display:grid;gap:6px;pointer-events:auto;max-height:70vh;overflow:auto;font-size:12px}
.dvf-train h3{margin:0;font:800 13px/1 var(--dv-font-display,system-ui);text-transform:uppercase;letter-spacing:.08em}
.dvf-mhead{font-weight:700}.dvf-mbar{display:flex;height:18px;border-radius:4px;overflow:hidden;margin:4px 0}
.dvf-mbar i{display:grid;place-items:center;font:700 11px/1 var(--dv-font-mono,monospace);font-style:normal;color:#001;min-width:18px}
.dvf-mS{background:#6fd3ff}.dvf-mA{background:repeating-linear-gradient(45deg,#ff5a5a 0 5px,#ff9a9a 5px 10px)}.dvf-mR{background:#ffd23f}
.dvf-mrows{display:flex;flex-wrap:wrap;gap:4px 12px;font-family:var(--dv-font-mono,monospace)}
.dvf-tdummy,.dvf-trec,.dvf-ttoggles{display:flex;flex-wrap:wrap;gap:4px;align-items:center}.dvf-tlabel{width:100%;color:var(--dv-color-text-muted,#aab4cc);text-transform:uppercase;letter-spacing:.06em;font-size:11px}
.dvf-tlast{font-family:var(--dv-font-mono,monospace);font-size:11px}
@media (max-height:480px){.dvf-train{top:auto;bottom:max(8px,env(safe-area-inset-bottom));right:auto;left:8px;width:min(40vw,260px);max-height:46vh}.dvf-inputs{display:none!important}.dvf-card{max-height:96vh;padding:8px;gap:6px}.dvf-cols{gap:8px}.dvf-banner{top:28%}}
.dvf[data-rm='1'] *{transition:none!important;animation:none!important}
`;
