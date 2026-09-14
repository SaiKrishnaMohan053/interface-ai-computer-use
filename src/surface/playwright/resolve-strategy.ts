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

type StructuralQuery = Extract<TargetStrategy, { kind: 'structural' }>['query'];

/**
 * Browser-context function.
 * Keep this self-contained and serialization-safe.
 */
export function resolveStructuralQuery(query: StructuralQuery): Element[] {
  type Match = {
    value: string;
    mode: 'exact' | 'contains';
    caseSensitive: boolean;
  };

  const helpers = {
    normalized(value: string): string {
      return value.replace(/\s+/g, ' ').trim();
    },

    matches(value: string, match: Match): boolean {
      const actual = helpers.normalized(value);
      const expected = helpers.normalized(match.value);

      const left = match.caseSensitive ? actual : actual.toLowerCase();

      const right = match.caseSensitive ? expected : expected.toLowerCase();

      return match.mode === 'exact' ? left === right : left.includes(right);
    },

    accessibleName(element: Element): string {
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

      if (element instanceof HTMLTableElement && element.caption) {
        return element.caption.textContent ?? '';
      }

      return element.textContent ?? '';
    },

    implicitRole(element: Element): string | null {
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
    },

    matchesDescriptor(
      element: Element,
      descriptor: {
        role?: string | undefined;
        name?: Match | undefined;
        text?: Match | undefined;
      },
    ): boolean {
      return (
        (descriptor.role === undefined || helpers.implicitRole(element) === descriptor.role) &&
        (descriptor.name === undefined ||
          helpers.matches(helpers.accessibleName(element), descriptor.name)) &&
        (descriptor.text === undefined ||
          helpers.matches(element.textContent ?? '', descriptor.text))
      );
    },
  };

  if (query.kind === 'table-cell') {
    const results: Element[] = [];

    for (const table of document.querySelectorAll('table')) {
      if (!helpers.matches(helpers.accessibleName(table), query.table.name)) {
        continue;
      }

      const rowHeaders = [...table.querySelectorAll('th')].filter((header) =>
        helpers.matches(header.textContent ?? '', query.row.columnHeader),
      );

      const resultHeaders = [...table.querySelectorAll('th')].filter((header) =>
        helpers.matches(header.textContent ?? '', query.column.header),
      );

      for (const rowHeader of rowHeaders) {
        const rowColumnIndex = rowHeader.cellIndex;

        for (const resultHeader of resultHeaders) {
          const resultColumnIndex = resultHeader.cellIndex;

          for (const row of table.querySelectorAll('tr')) {
            const cells = [...row.querySelectorAll(':scope > th, :scope > td')];

            const rowKeyCell = cells[rowColumnIndex];

            if (!rowKeyCell || !helpers.matches(rowKeyCell.textContent ?? '', query.row.value)) {
              continue;
            }

            const target = cells[resultColumnIndex];

            if (target && target !== rowHeader && target !== resultHeader) {
              results.push(target);
            }
          }
        }
      }
    }

    return [...new Set(results)];
  }

  const results: Element[] = [];

  const containers = [...document.querySelectorAll('body *')].filter((element) =>
    helpers.matchesDescriptor(element, query.container),
  );

  for (const container of containers) {
    const targets = [...container.querySelectorAll('*')].filter((element) =>
      helpers.matchesDescriptor(element, query.target),
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
}

async function structuralHandles(
  page: Page,
  strategy: Extract<TargetStrategy, { kind: 'structural' }>,
): Promise<ElementHandle<HTMLElement | SVGElement>[]> {
  const arrayHandle = await page.evaluateHandle(resolveStructuralQuery, strategy.query);

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
