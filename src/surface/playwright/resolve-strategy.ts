import type { ElementHandle, Locator, Page } from 'playwright';

import type { TargetStrategy, TargetTextMatch } from '../../targeting/index.js';

/**
 * Temporary support for 1.6 direct adapter tests.
 * TargetResolver uses the new TargetStrategy variants.
 */
export type LegacyPlaywrightStrategy =
  | {
      kind: 'role';
      role: Parameters<Page['getByRole']>[0];
      name: string;
    }
  | {
      kind: 'label';
      text: string;
    }
  | {
      kind: 'text';
      text: string;
    }
  | {
      kind: 'css';
      selector: string;
    };

export type PlaywrightStrategy = TargetStrategy | LegacyPlaywrightStrategy;

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function matcher(match: TargetTextMatch): string | RegExp {
  const normalizedPattern = match.value
    .trim()
    .split(/\s+/)
    .map(escapeRegularExpression)
    .join('\\s+');

  const pattern = match.mode === 'exact' ? `^\\s*${normalizedPattern}\\s*$` : normalizedPattern;

  return new RegExp(pattern, match.caseSensitive ? '' : 'i');
}

function locator(
  page: Page,

  strategy: Exclude<PlaywrightStrategy, { kind: 'structural' }>,
): Locator {
  switch (strategy.kind) {
    case 'role':
      return page.getByRole(strategy.role, {
        name: strategy.name,
        exact: true,
      });

    case 'role-name':
      return page.getByRole(strategy.role as Parameters<Page['getByRole']>[0], {
        name: matcher(strategy.name),
      });

    case 'label':
      return 'label' in strategy
        ? page.getByLabel(matcher(strategy.label))
        : page.getByLabel(strategy.text, { exact: true });

    case 'text':
      return typeof strategy.text === 'string'
        ? page.getByText(strategy.text, { exact: true })
        : page.getByText(matcher(strategy.text));

    case 'css':
      return page.locator(strategy.selector);

    case 'xpath':
      return page.locator(`xpath=${strategy.expression}`);
  }
}

async function structuralHandles(
  page: Page,

  strategy: Extract<TargetStrategy, { kind: 'structural' }>,
): Promise<ElementHandle<HTMLElement | SVGElement>[]> {
  const arrayHandle = await page.evaluateHandle((query) => {
    type Match = {
      value: string;
      mode: 'exact' | 'contains';
      caseSensitive: boolean;
    };

    const normalized = (value: string): string => value.replace(/\s+/g, ' ').trim();

    const matches = (value: string, match: Match): boolean => {
      const actual = normalized(value);

      const expected = normalized(match.value);

      const left = match.caseSensitive ? actual : actual.toLowerCase();

      const right = match.caseSensitive ? expected : expected.toLowerCase();

      return match.mode === 'exact' ? left === right : left.includes(right);
    };

    const accessibleName = (element: Element): string => {
      const label = element.getAttribute('aria-label');

      if (label !== null) {
        return label;
      }

      const labelledBy = element.getAttribute('aria-labelledby');

      if (labelledBy) {
        return labelledBy
          .split(/\s+/)
          .map((id) => document.getElementById(id)?.textContent ?? '')
          .join(' ');
      }

      return element.textContent ?? '';
    };

    const implicitRole = (element: Element): string | null => {
      const explicit = element.getAttribute('role');

      if (explicit) {
        return explicit;
      }

      const tag = element.tagName.toLowerCase();

      if (tag === 'button') {
        return 'button';
      }

      if (tag === 'a' && element.hasAttribute('href')) {
        return 'link';
      }

      if (tag === 'select') {
        return 'combobox';
      }

      if (tag === 'textarea') {
        return 'textbox';
      }

      if (tag === 'dialog') {
        return 'dialog';
      }

      if (tag === 'form') {
        return 'form';
      }

      if (tag === 'tr') {
        return 'row';
      }

      if (tag === 'td') {
        return 'cell';
      }

      if (tag === 'th') {
        return 'columnheader';
      }

      if (tag === 'input') {
        const type = (element.getAttribute('type') ?? 'text').toLowerCase();

        if (type === 'checkbox') {
          return 'checkbox';
        }

        if (type === 'radio') {
          return 'radio';
        }

        if (['button', 'submit', 'reset'].includes(type)) {
          return 'button';
        }

        return 'textbox';
      }

      return null;
    };

    const matchesDescriptor = (
      element: Element,

      descriptor: {
        role?: string | undefined;
        name?: Match | undefined;
        text?: Match | undefined;
      },
    ): boolean =>
      (descriptor.role === undefined || implicitRole(element) === descriptor.role) &&
      (descriptor.name === undefined || matches(accessibleName(element), descriptor.name)) &&
      (descriptor.text === undefined || matches(element.textContent ?? '', descriptor.text));

    if (query.kind === 'table-cell') {
      const results: Element[] = [];

      for (const table of document.querySelectorAll('table')) {
        const headers = [...table.querySelectorAll('th')].filter((header) =>
          matches(header.textContent ?? '', query.columnHeader),
        );

        for (const header of headers) {
          const columnIndex = header.cellIndex;

          for (const row of table.querySelectorAll('tr')) {
            const cells = [...row.querySelectorAll(':scope > th, :scope > td')];

            if (!cells.some((cell) => matches(cell.textContent ?? '', query.rowAnchor))) {
              continue;
            }

            const target = cells[columnIndex];

            if (target && target !== header) {
              results.push(target);
            }
          }
        }
      }

      return [...new Set(results)];
    }

    const results: Element[] = [];

    const containers = [...document.querySelectorAll('body *')].filter((element) =>
      matchesDescriptor(element, query.container),
    );

    for (const container of containers) {
      const targets = [...container.querySelectorAll('*')].filter((element) =>
        matchesDescriptor(element, query.target),
      );

      if (query.target.zeroBasedIndex === undefined) {
        results.push(...targets);
      } else {
        const selected = targets[query.target.zeroBasedIndex];

        if (selected) {
          results.push(selected);
        }
      }
    }

    return [...new Set(results)];
  }, strategy.query);

  try {
    const properties = await arrayHandle.getProperties();

    const handles: ElementHandle<HTMLElement | SVGElement>[] = [];

    for (const property of properties.values()) {
      const element = property.asElement();

      if (element) {
        handles.push(element as ElementHandle<HTMLElement | SVGElement>);
      } else {
        await property.dispose();
      }
    }

    return handles;
  } finally {
    await arrayHandle.dispose();
  }
}

export async function resolvePlaywrightStrategy(
  page: Page,
  strategy: PlaywrightStrategy,
): Promise<ElementHandle<HTMLElement | SVGElement>[]> {
  return strategy.kind === 'structural'
    ? structuralHandles(page, strategy)
    : ((await locator(page, strategy).elementHandles()) as ElementHandle<
        HTMLElement | SVGElement
      >[]);
}
