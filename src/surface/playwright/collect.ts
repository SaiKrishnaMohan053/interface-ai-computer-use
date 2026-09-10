import type { ObservableControl, ObservableDialog } from '../contracts.js';

export function collect(options: { maxTextLength: number; maxControls: number }) {
  const visible = (el: Element): el is HTMLElement =>
    el instanceof HTMLElement &&
    el.checkVisibility({
      checkOpacity: true,
      checkVisibilityCSS: true,
    });

  const name = (el: HTMLElement): string => {
    const ids = el.getAttribute('aria-labelledby');

    if (ids) {
      return ids
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.innerText ?? '')
        .join(' ')
        .trim();
    }

    const aria = el.getAttribute('aria-label');

    if (aria !== null) {
      return aria;
    }

    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement
    ) {
      const label = [...(el.labels ?? [])]
        .map((item) => item.innerText)
        .join(' ')
        .trim();

      if (label) {
        return label;
      }
    }

    return el.innerText?.trim() || el.getAttribute('placeholder') || el.getAttribute('title') || '';
  };

  const all = [
    ...document.querySelectorAll(
      'button,a[href],input,textarea,select,[role],[contenteditable="true"]',
    ),
  ]
    .filter(visible)
    .filter(
      (el) =>
        !['dialog', 'alert', 'status', 'presentation', 'navigation'].includes(
          el.getAttribute('role') ?? '',
        ),
    );

  const elements = all.slice(0, options.maxControls);

  const controls: ObservableControl[] = elements.map((el, index) => {
    const bounds = el.getBoundingClientRect();

    const base = {
      controlId: String(index),
      name: name(el),
      role: el.getAttribute('role'),
      visible: true,
      enabled: !el.matches(':disabled') && el.getAttribute('aria-disabled') !== 'true',
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    };

    if (el instanceof HTMLSelectElement) {
      return {
        ...base,
        role: base.role ?? 'combobox',
        kind: 'select',
        multiple: el.multiple,
        options: [...el.options].map((option) => ({
          label: option.label,
          value: option.value,
          selected: option.selected,
          enabled:
            !option.disabled &&
            !(option.parentElement instanceof HTMLOptGroupElement && option.parentElement.disabled),
        })),
      };
    }

    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      return {
        ...base,
        role: base.role ?? 'checkbox',
        kind: 'checkbox',
        checked: el.checked,
        indeterminate: el.indeterminate,
      };
    }

    if (el instanceof HTMLInputElement && el.type === 'radio') {
      return {
        ...base,
        role: base.role ?? 'radio',
        kind: 'radio',
        checked: el.checked,
      };
    }

    if (
      el instanceof HTMLButtonElement ||
      (el instanceof HTMLInputElement && ['submit', 'button', 'reset'].includes(el.type))
    ) {
      return {
        ...base,
        name: base.name || (el instanceof HTMLInputElement ? el.value : ''),
        role: base.role ?? 'button',
        kind: 'button',
      };
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      const type = el instanceof HTMLInputElement ? el.type : 'text';

      const inputType =
        type === 'text' || type === 'password' || type === 'email' || type === 'number'
          ? type
          : 'other';

      return {
        ...base,
        role: base.role ?? 'textbox',
        kind: 'text_input',
        inputType,
        value: type === 'password' ? null : el.value,
        readOnly: el.readOnly,
      };
    }

    if (el instanceof HTMLAnchorElement) {
      return {
        ...base,
        role: base.role ?? 'link',
        kind: 'link',
        destination: el.href,
      };
    }

    return {
      ...base,
      kind: 'other',
      value: null,
    };
  });

  const dialogs: ObservableDialog[] = [
    ...document.querySelectorAll('dialog,[role="dialog"],[role="alertdialog"]'),
  ]
    .filter(visible)
    .map((el, index) => ({
      kind: 'surface',
      dialogId: `surface-${index}`,
      presentation: el.matches(':modal,[aria-modal="true"]') ? 'modal' : 'interstitial',
      title: name(el) || null,
      text: el.innerText.slice(0, options.maxTextLength),
      controlIds: elements.flatMap((control, controlIndex) =>
        el.contains(control) ? [String(controlIndex)] : [],
      ),
    }));

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

  const parts: string[] = [];
  let length = 0;
  let node: Node | null;

  while ((node = walker.nextNode())) {
    const el = node.parentElement;

    if (!el || el.closest('script,style,noscript') || !visible(el)) {
      continue;
    }

    const value = node.textContent?.trim() ?? '';

    if (value) {
      parts.push(value);
      length += value.length + 1;
    }

    if (length > options.maxTextLength) {
      break;
    }
  }

  const text = parts.join('\n');

  return {
    visibleText: text.slice(0, options.maxTextLength),
    controls,
    dialogs,
    loading: [...document.querySelectorAll('[aria-busy="true"]')].some(visible)
      ? ('loading' as const)
      : ('unknown' as const),
    truncated: {
      visibleText: text.length > options.maxTextLength,
      controls: all.length > options.maxControls,
    },
  };
}
