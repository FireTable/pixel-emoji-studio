export function dismissOnBackdrop(dialog: HTMLDialogElement, close: () => void) {
  if ("closedBy" in HTMLDialogElement.prototype) return;

  function isBackdrop(event: MouseEvent) {
    if (event.target !== dialog) return false;
    const { left, right, top, bottom } = dialog.getBoundingClientRect();
    return event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom;
  }

  let pressedOutside = false;
  function pointerDown(event: PointerEvent) {
    pressedOutside = isBackdrop(event);
  }
  function click(event: MouseEvent) {
    const shouldClose = pressedOutside && isBackdrop(event);
    pressedOutside = false;
    if (shouldClose) close();
  }

  dialog.addEventListener("pointerdown", pointerDown);
  dialog.addEventListener("click", click);
  return {
    destroy() {
      dialog.removeEventListener("pointerdown", pointerDown);
      dialog.removeEventListener("click", click);
    },
  };
}
