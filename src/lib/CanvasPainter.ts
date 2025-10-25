import { AnimationFrame } from "@opendaw/lib-dom";
import { Terminable } from "@opendaw/lib-std";

/**
 * CanvasPainter wraps a canvas element and provides efficient rendering
 * using AnimationFrame scheduling and update debouncing.
 *
 * Inspired by OpenDAW's internal CanvasPainter implementation.
 */
export class CanvasPainter implements Terminable {
  private needsUpdate = true;
  private isResized = false;
  private lastWidth = 0;
  private lastHeight = 0;
  private lastDevicePixelRatio = 0;
  private animationFrameTerminable: Terminable | null = null;
  private resizeObserver: ResizeObserver | null = null;

  constructor(
    private canvas: HTMLCanvasElement,
    private render: (painter: CanvasPainter, context: CanvasRenderingContext2D) => void
  ) {
    // Start animation frame loop
    this.animationFrameTerminable = AnimationFrame.add(() => this.update());

    // Watch for canvas resize
    this.resizeObserver = new ResizeObserver(() => {
      this.requestUpdate();
    });
    this.resizeObserver.observe(canvas);
  }

  /**
   * Request a canvas update on the next animation frame.
   * Multiple calls between frames are debounced to a single render.
   */
  requestUpdate = (): void => {
    this.needsUpdate = true;
  };

  /**
   * Returns true if the canvas was resized since last render.
   */
  get wasResized(): boolean {
    return this.isResized;
  }

  private update(): void {
    if (!this.needsUpdate) {
      return;
    }

    this.needsUpdate = false;

    const { canvas } = this;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const devicePixelRatio = window.devicePixelRatio || 1;

    // Skip rendering if canvas has no size
    if (width === 0 || height === 0) {
      return;
    }

    // Detect resize
    this.isResized =
      this.lastWidth !== width ||
      this.lastHeight !== height ||
      this.lastDevicePixelRatio !== devicePixelRatio;

    if (this.isResized) {
      // Update canvas resolution for HiDPI displays
      canvas.width = Math.floor(width * devicePixelRatio);
      canvas.height = Math.floor(height * devicePixelRatio);

      this.lastWidth = width;
      this.lastHeight = height;
      this.lastDevicePixelRatio = devicePixelRatio;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    // Scale context for HiDPI
    context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);

    // Call user's render function
    this.render(this, context);
  }

  terminate(): void {
    if (this.animationFrameTerminable) {
      this.animationFrameTerminable.terminate();
      this.animationFrameTerminable = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }
}
