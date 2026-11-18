<script lang="ts">
  let { before, after, beforeLabel, afterLabel, label }: {
    before: ImageData;
    after: ImageData;
    beforeLabel: string;
    afterLabel: string;
    label: string;
  } = $props();

  let position = $state(50);

  function draw(canvas: HTMLCanvasElement, image: ImageData) {
    function paint(next: ImageData) {
      canvas.width = next.width;
      canvas.height = next.height;
      canvas.getContext("2d")?.putImageData(next, 0, 0);
    }

    paint(image);
    return { update: paint };
  }
</script>

<div class="comparison" style:--split={`${position}%`}>
  <div class="layer before" aria-hidden="true">
    <canvas use:draw={before}></canvas>
    <span>{beforeLabel}</span>
  </div>
  <div class="layer after" aria-hidden="true">
    <canvas use:draw={after}></canvas>
    <span>{afterLabel}</span>
  </div>

  <input
    type="range"
    min="0"
    max="100"
    step="1"
    aria-label={label}
    aria-valuetext={`${beforeLabel} ${position}%, ${afterLabel} ${100 - position}%`}
    bind:value={position}
  />
  <div class="divider" aria-hidden="true"></div>
  <span class="handle" aria-hidden="true">↔</span>
</div>

<style>
  .comparison {
    --thumb: 40px;
    position: absolute;
    inset: 0;
    overflow: hidden;
    border-radius: inherit;
    isolation: isolate;
  }

  .layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .before {
    clip-path: inset(0 calc(100% - var(--split)) 0 0);
  }

  .after {
    clip-path: inset(0 0 0 var(--split));
  }

  canvas {
    position: absolute;
    inset: 10%;
    width: 80%;
    height: 80%;
    image-rendering: pixelated;
  }

  .layer span {
    position: absolute;
    top: 10px;
    padding: 4px 8px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink);
    font-size: 0.6875rem;
    font-weight: 650;
    line-height: 1.25;
    white-space: nowrap;
  }

  .before span { left: 10px; }
  .after span { right: 10px; }

  input {
    appearance: none;
    position: absolute;
    z-index: 1;
    top: 0;
    left: calc(var(--thumb) / -2);
    width: calc(100% + var(--thumb));
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    direction: ltr;
    cursor: ew-resize;
    touch-action: pan-y;
  }

  input::-webkit-slider-thumb {
    appearance: none;
    width: var(--thumb);
    height: var(--thumb);
  }

  input::-moz-range-thumb {
    width: var(--thumb);
    height: var(--thumb);
    border: 0;
  }

  .divider {
    position: absolute;
    inset: 0 auto 0 var(--split);
    width: 2px;
    background: var(--surface);
    box-shadow: 0 0 0 1px var(--ink);
    transform: translateX(-50%);
    pointer-events: none;
  }

  .handle {
    position: absolute;
    top: 50%;
    left: clamp(16px, var(--split), calc(100% - 16px));
    display: grid;
    width: 30px;
    height: 30px;
    place-items: center;
    border: 1px solid var(--ink);
    border-radius: 50%;
    background: var(--surface);
    color: var(--ink);
    font-size: 16px;
    font-weight: 700;
    line-height: 1;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  input:focus-visible ~ .handle {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
