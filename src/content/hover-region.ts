interface Point {
  x: number;
  y: number;
}

type Rect = Pick<
  DOMRect,
  'left' | 'right' | 'top' | 'bottom' | 'width' | 'height'
>;

const cross = (a: Point, b: Point, c: Point): number =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** The title, the card and the space joining them, in either direction. */
export function isInHoverRegion(
  point: Point,
  title: Rect,
  card: Rect,
): boolean {
  if (
    title.width <= 0 ||
    title.height <= 0 ||
    card.width <= 0 ||
    card.height <= 0
  )
    return false;
  const padding = 8;
  const corners = [title, card]
    .flatMap((rect) => [
      { x: rect.left - padding, y: rect.top - padding },
      { x: rect.right + padding, y: rect.top - padding },
      { x: rect.right + padding, y: rect.bottom + padding },
      { x: rect.left - padding, y: rect.bottom + padding },
    ])
    .sort((a, b) => a.x - b.x || a.y - b.y);
  const half = (points: Point[]): Point[] => {
    const hull: Point[] = [];
    for (const next of points) {
      while (
        hull.length >= 2 &&
        cross(hull[hull.length - 2]!, hull[hull.length - 1]!, next) <= 0
      )
        hull.pop();
      hull.push(next);
    }
    return hull.slice(0, -1);
  };
  // A convex hull supports side, above and below placement without making the
  // whole surrounding bounding rectangle a sticky hover target.
  const hull = [...half(corners), ...half([...corners].reverse())];
  return hull.every(
    (start, index) =>
      cross(start, hull[(index + 1) % hull.length]!, point) >= 0,
  );
}
