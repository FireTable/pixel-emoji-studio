<script lang="ts">
  const decorations = [
    [
      { file: '03', x: 35, y: 22, size: 52, angle: -10 },
      { file: '52', x: 68, y: 40, size: 40, angle: 12 },
      { file: '17', x: 43, y: 58, size: 46, angle: 8 },
      { file: '40', x: 32, y: 84, size: 58, angle: 6 },
      { file: '33', x: 68, y: 93, size: 40, angle: -8 },
    ],
    [
      { file: '61', x: 35, y: 18, size: 55, angle: 9 },
      { file: '88', x: 68, y: 33, size: 37, angle: 6 },
      { file: '70', x: 58, y: 52, size: 43, angle: -7 },
      { file: '22', x: 67, y: 82, size: 52, angle: -12 },
      { file: '47', x: 32, y: 94, size: 43, angle: 10 },
    ],
  ]
</script>

<div class="decorations" aria-hidden="true">
  {#each decorations as side}
    <div class="rail">
      {#each side as { file, x, y, size, angle } (file)}
        <img
          src="/confetti/{file}.png"
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          style:left={`${x}%`}
          style:top={`${y}%`}
          style:--angle={`${angle}deg`}
        />
      {/each}
    </div>
  {/each}
</div>

<style>
  .decorations {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 0;
    overflow: hidden;
    pointer-events: none;
    opacity: 0.46;
  }

  .rail {
    position: relative;
    grid-area: 1 / 1;
  }

  .rail:last-child {
    grid-column: 3;
  }

  img {
    position: absolute;
    transform: translate(-50%, -50%) rotate(var(--angle));
    image-rendering: pixelated;
  }

  @media (min-width: 1280px) and (min-height: 560px) {
    .decorations {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 1080px minmax(0, 1fr);
    }
  }
</style>
