import { createSessionStore } from "../session-store";
import type { AuthSessionSnapshot } from "../Auth.nitro";

it("shares a single subscription, closes the registration gap, and ignores stale snapshots", () => {
  let snapshot: AuthSessionSnapshot = { revision: 0, scopes: [] };
  let deliver: ((value: AuthSessionSnapshot) => void) | undefined;
  const remove = jest.fn();
  const backend = {
    getSessionSnapshot: jest.fn(() => snapshot),
    onSessionChanged: jest.fn(
      (callback: (value: AuthSessionSnapshot) => void) => {
        deliver = callback;
        snapshot = {
          revision: 1,
          user: { provider: "google" },
          scopes: ["email"],
        };
        return remove;
      },
    ),
  };
  const store = createSessionStore(backend);
  expect(store.getSnapshot().revision).toBe(0);
  const first = store.subscribe(jest.fn());
  const second = store.subscribe(jest.fn());
  expect(backend.onSessionChanged).toHaveBeenCalledTimes(1);
  expect(store.getSnapshot().user?.provider).toBe("google");
  const reads = backend.getSessionSnapshot.mock.calls.length;
  for (let i = 0; i < 100; i++) store.getSnapshot();
  expect(backend.getSessionSnapshot).toHaveBeenCalledTimes(reads);
  deliver?.({ revision: 0, scopes: [] });
  expect(store.getSnapshot().revision).toBe(1);
  first();
  first();
  expect(remove).not.toHaveBeenCalled();
  second();
  expect(remove).toHaveBeenCalledTimes(1);
});

it("refreshes an inactive store when mounted again", () => {
  let snapshot: AuthSessionSnapshot = { revision: 0, scopes: [] };
  const store = createSessionStore({
    getSessionSnapshot: () => snapshot,
    onSessionChanged: () => () => {},
  });
  const remove = store.subscribe(() => {});
  remove();
  snapshot = { revision: 1, scopes: ["email"] };
  expect(store.getSnapshot().scopes).toEqual(["email"]);
});

it("releases a failed subscription so a later mount can retry", () => {
  const backend = {
    getSessionSnapshot: () => ({ revision: 0, scopes: [] }),
    onSessionChanged: jest
      .fn()
      .mockImplementationOnce(() => {
        throw new Error("registration failed");
      })
      .mockReturnValue(() => {}),
  };
  const store = createSessionStore(backend);
  expect(() => store.subscribe(() => {})).toThrow("registration failed");
  store.subscribe(() => {});
  expect(backend.onSessionChanged).toHaveBeenCalledTimes(2);
});
