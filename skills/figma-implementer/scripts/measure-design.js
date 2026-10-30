() => {
  // Measures elements of the running page for comparison with a design: each target's box, layout,
  // typography, colors, borders, effects, text, and the gaps between its visible children.
  // Set TARGETS before running, one per element of the spec ledger, then pass this function unchanged
  // as the `function` of evaluate_script. `children: true` also reports a container's child gaps.
  // Returns compact JSON; properties at their default (no shadow, opacity 1, no border) are left out.
  const TARGETS = [
    // { name: 'card', selector: '[data-testid="pricing-card"]', children: true },
  ];

  const round = (value) => Math.round(value * 10) / 10;
  const px = (value) => (/^-?[\d.]+px$/.test(value) ? round(Number.parseFloat(value)) : value);
  const hex = (value) => {
    const match = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)/.exec(value || '');
    if (!match) return value;
    const [r, g, b] = match.slice(1, 4).map((part) => Math.round(Number(part)));
    const alpha = match[4] === undefined ? 1 : match[4].endsWith('%') ? Number.parseFloat(match[4]) / 100 : Number(match[4]);
    if (alpha === 0) return 'transparent';
    const two = (n) => n.toString(16).padStart(2, '0');
    return `#${two(r)}${two(g)}${two(b)}${alpha < 1 ? two(Math.round(alpha * 255)) : ''}`;
  };
  const sides = (style, name) => ['Top', 'Right', 'Bottom', 'Left'].map((side) => px(style[`${name}${side}`]));
  const same = (list) => list.every((item) => item === list[0]);
  const visible = (el) => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return box.width > 0 && box.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  };

  const measure = (el) => {
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    const out = {
      box: { x: round(box.left), y: round(box.top), width: round(box.width), height: round(box.height) },
      display: s.display,
    };
    if (s.display.includes('flex') || s.display.includes('grid')) {
      Object.assign(out, {
        direction: s.flexDirection,
        wrap: s.flexWrap,
        justify: s.justifyContent,
        align: s.alignItems,
        gap: same([s.rowGap, s.columnGap]) ? px(s.rowGap) : [px(s.rowGap), px(s.columnGap)],
      });
    }
    const padding = sides(s, 'padding');
    if (padding.some((value) => value !== 0)) out.padding = same(padding) ? padding[0] : padding;
    const hasText = [...el.childNodes].some((node) => node.nodeType === 3 && node.textContent.trim());
    if (hasText) {
      Object.assign(out, {
        text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 80),
        font: s.fontFamily.split(',')[0].replace(/["']/g, '').trim(),
        fontSize: px(s.fontSize),
        fontWeight: Number(s.fontWeight),
        lineHeight: px(s.lineHeight),
        letterSpacing: s.letterSpacing === 'normal' ? 0 : px(s.letterSpacing),
        color: hex(s.color),
        textAlign: s.textAlign,
      });
      if (s.textTransform !== 'none') out.textTransform = s.textTransform;
      if (s.textDecorationLine !== 'none') out.textDecoration = s.textDecorationLine;
    }
    const background = hex(s.backgroundColor);
    if (background !== 'transparent') out.background = background;
    if (s.backgroundImage !== 'none') out.backgroundImage = s.backgroundImage.slice(0, 120);
    const borderWidths = ['Top', 'Right', 'Bottom', 'Left'].map((side) => px(s[`border${side}Width`]));
    if (borderWidths.some((value) => value > 0)) {
      const colors = ['Top', 'Right', 'Bottom', 'Left'].map((side) => hex(s[`border${side}Color`]));
      out.border = same(borderWidths) && same(colors) ? `${borderWidths[0]} ${s.borderTopStyle} ${colors[0]}` : { widths: borderWidths, colors };
    }
    const radius = ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map((corner) => px(s[`border${corner}Radius`]));
    if (radius.some((value) => value !== 0)) out.radius = same(radius) ? radius[0] : radius;
    if (s.boxShadow !== 'none') out.shadow = s.boxShadow.replace(/rgba?\([^)]*\)/g, (color) => hex(color));
    if (Number(s.opacity) !== 1) out.opacity = Number(s.opacity);
    return out;
  };

  const results = TARGETS.map(({ name, selector, children }) => {
    const found = document.querySelectorAll(selector);
    if (!found.length) return { name, selector, found: 0 };
    const el = found[0];
    const entry = { name, ...(found.length > 1 ? { matches: found.length } : {}), ...measure(el) };
    if (children) {
      const kids = [...el.children].filter(visible).map((kid) => kid.getBoundingClientRect());
      const column = entry.direction ? entry.direction.startsWith('column') : kids.length > 1 && kids[1].top >= kids[0].bottom - 1;
      entry.children = kids.length;
      entry.gaps = kids.slice(1).map((kid, i) => round(column ? kid.top - kids[i].bottom : kid.left - kids[i].right));
    }
    return entry;
  });
  return JSON.stringify({ viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio }, results });
}
