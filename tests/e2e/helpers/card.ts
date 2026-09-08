import { expect, type BrowserContext, type Page } from '@playwright/test';

interface DomNode {
  nodeId: number;
  attributes?: string[];
  children?: DomNode[];
  shadowRoots?: DomNode[];
}

const flatten = (node: DomNode): DomNode[] => [
  node,
  ...(node.children ?? []).flatMap(flatten),
  ...(node.shadowRoots ?? []).flatMap(flatten),
];

async function withCardNode<T>(
  context: BrowserContext,
  page: Page,
  selector: string,
  operation: (
    cdp: Awaited<ReturnType<BrowserContext['newCDPSession']>>,
    nodeId: number,
  ) => Promise<T>,
  hostAttribute = 'data-attention-preview',
): Promise<T> {
  const cdp = await context.newCDPSession(page);
  try {
    const { root } = await cdp.send('DOM.getDocument', {
      depth: -1,
      pierce: true,
    });
    const host = flatten(root).find((node) =>
      node.attributes?.includes(hostAttribute),
    );
    const shadow = host?.shadowRoots?.[0];
    expect(shadow, `${hostAttribute} shadow root`).toBeTruthy();
    const { nodeId } = await cdp.send('DOM.querySelector', {
      nodeId: shadow!.nodeId,
      selector,
    });
    expect(nodeId, `card element ${selector}`).toBeGreaterThan(0);
    return await operation(cdp, nodeId);
  } finally {
    await cdp.detach();
  }
}

export async function shadowElementState(
  context: BrowserContext,
  page: Page,
  selector: string,
  hostAttribute = 'data-attention-preview',
): Promise<{
  background: string;
  color: string;
  colorScheme: string;
  value: string | null;
  open: boolean | null;
  focused: boolean;
}> {
  return await withCardNode(
    context,
    page,
    selector,
    async (cdp, nodeId) => {
      const { object } = await cdp.send('DOM.resolveNode', { nodeId });
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId!,
        functionDeclaration: `function() {
        const style = getComputedStyle(this);
        return { background: style.backgroundColor, color: style.color,
          colorScheme: style.colorScheme, value: this.value ?? null,
          open: this.open ?? null, focused: this.getRootNode().activeElement === this };
      }`,
        returnByValue: true,
      });
      return result.value;
    },
    hostAttribute,
  );
}

export async function clickCardElement(
  context: BrowserContext,
  page: Page,
  selector: string,
): Promise<void> {
  let center = { x: 0, y: 0 };
  // Retry only the read/scroll phase. The real click occurs exactly once.
  await expect(async () => {
    center = await withCardNode(
      context,
      page,
      selector,
      async (cdp, nodeId) => {
        await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId });
        const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
        expect(model.width).toBeGreaterThan(0);
        expect(model.height).toBeGreaterThan(0);
        return {
          x: (model.content[0] + model.content[4]) / 2,
          y: (model.content[1] + model.content[5]) / 2,
        };
      },
    );
  }).toPass({ timeout: 5000 });
  await page.mouse.click(center.x, center.y);
}

export async function cardTextContent(
  context: BrowserContext,
  page: Page,
  selector: string,
  hostAttribute = 'data-attention-preview',
): Promise<string> {
  return await withCardNode(
    context,
    page,
    selector,
    async (cdp, nodeId) => {
      const { object } = await cdp.send('DOM.resolveNode', { nodeId });
      const { result } = await cdp.send('Runtime.callFunctionOn', {
        objectId: object.objectId!,
        functionDeclaration: 'function() { return this.textContent; }',
        returnByValue: true,
      });
      return String(result.value ?? '');
    },
    hostAttribute,
  );
}

export async function selectCardOption(
  context: BrowserContext,
  page: Page,
  selector: string,
  index: number,
): Promise<void> {
  // Equivalent to Playwright selectOption for a visible control inside the
  // extension's closed shadow root. The page itself cannot access this node.
  // Applying the draft below still requires a real, trusted user click.
  await withCardNode(context, page, selector, async (cdp, nodeId) => {
    await cdp.send('DOM.scrollIntoViewIfNeeded', { nodeId });
    const { model } = await cdp.send('DOM.getBoxModel', { nodeId });
    expect(model.width).toBeGreaterThan(0);
    expect(model.height).toBeGreaterThan(0);
    const { object } = await cdp.send('DOM.resolveNode', { nodeId });
    await cdp.send('Runtime.callFunctionOn', {
      objectId: object.objectId!,
      functionDeclaration: `function(index) {
        this.focus();
        this.selectedIndex = index;
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
      }`,
      arguments: [{ value: index }],
    });
  });
}

export async function fillCardInput(
  context: BrowserContext,
  page: Page,
  selector: string,
  value: string,
): Promise<void> {
  await clickCardElement(context, page, selector);
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.insertText(value);
}
