import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Dimensions, PanResponder, type GestureResponderEvent, type PanResponderCallbacks, type PanResponderGestureState } from 'react-native';
import { ArcDial } from '../nav/ArcDial';

jest.mock('../haptics', () => ({ tapFeedback: jest.fn(), tickFeedback: jest.fn() }));

afterEach(() => jest.restoreAllMocks());

it('resets a cancelled dial preview when an accessibility action stays at the first session', async () => {
  const centerY = Dimensions.get('window').height * 0.48;
  const gesture: PanResponderGestureState = {
    stateID: 1, moveX: 0, moveY: centerY, x0: 0, y0: centerY,
    dx: 0, dy: 0, vx: 0, vy: 0, numberActiveTouches: 1,
  };
  const event = { nativeEvent: {} } as GestureResponderEvent;
  const captured: { strip?: PanResponderCallbacks } = {};
  const create = PanResponder.create;
  jest.spyOn(PanResponder, 'create').mockImplementation((handlers) => {
    if (handlers.onStartShouldSetPanResponder?.(event, gesture)) captured.strip = handlers;
    return create(handlers);
  });
  const selected = jest.fn();
  const sessions = ['first', 'second', 'third'].map((sessionId) => ({
    sessionId, updatedAt: 1, running: false, blank: false,
  }));
  function Harness() {
    const [activeId, setActiveId] = useState('first');
    // App's ErrorBoundary remounts the session subtree on a real session change.
    return <ArcDial key={activeId} sessions={sessions} activeId={activeId} onSelect={(id) => {
      selected(id);
      setActiveId(id);
    }} />;
  }
  await render(<Harness />);
  // Preview the second session, then let the system cancel the gesture and close the dial.
  await act(() => captured.strip!.onPanResponderGrant!(event, gesture));
  await act(() => captured.strip!.onPanResponderMove!(event, { ...gesture, moveY: centerY - 53, dy: -53 }));
  await act(() => captured.strip!.onPanResponderTerminate!(event, gesture));
  await fireEvent.press(screen.getAllByRole('button', { name: '收起会话转盘' })[0]);
  await fireEvent(screen.getByRole('adjustable'), 'accessibilityAction', {
    nativeEvent: { actionName: 'decrement' },
  });
  // Already at the first session: no navigation/remount resets the preview for us.
  expect(selected).not.toHaveBeenCalled();
  const moved = { ...gesture, moveY: centerY - 4, dy: -4 };
  await act(() => captured.strip!.onPanResponderGrant!(event, gesture));
  await act(() => captured.strip!.onPanResponderMove!(event, moved));
  await act(() => captured.strip!.onPanResponderRelease!(event, moved));
  expect(selected).not.toHaveBeenCalled();
});
