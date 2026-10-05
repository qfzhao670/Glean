type ComposerKeyEvent = {
  key: string;
  shiftKey: boolean;
  nativeEvent: {
    isComposing: boolean;
    keyCode?: number;
  };
};

export function shouldSubmitComposer(event: ComposerKeyEvent) {
  return event.key === 'Enter'
    && !event.shiftKey
    && !event.nativeEvent.isComposing
    && event.nativeEvent.keyCode !== 229;
}
