# Device log relay — reading a headset's logs without adb (`doc/13-device-logs.md`)

> **Status: implemented.**

Reading `adb logcat` to find out what an app did on a headset is slow and, on Quest, unreliable: the
cable falls out, the device sleeps, and a VR app cannot be launched from `adb` at all while the headset is
off the user's head. This relays the app's own log to the machine that built it.

```
headset                                    dev machine
┌──────────────────────┐                  ┌────────────────────────┐
│ ArsistLogRelay       │ ── UDP/9770 ──►  │ npm run logs           │
│  Application.log…    │   fire-and-      │  binds the port,       │
│  → queue → thread    │   forget         │  prints matching lines │
└──────────────────────┘                  └────────────────────────┘
```

## Why the builder machine is trusted automatically

`UnityBuilder.resolveLogRelay` reads this machine's LAN IPv4 addresses at build time (`listLanAddresses`,
skipping loopback and virtual NICs such as `docker*` / `veth*` / `virbr*` / `br-*`) and writes them into
the manifest as `logRelay { enabled, hosts, port, token }`, and `ArsistBuildPipeline.EnsureLogRelayInScene` bakes them into the scene. **The app can
only talk to the machine that built it**, so there is no pairing step, no discovery protocol, and no
service to run on the device.

The trade-off is that the address is fixed at build time: move to another network and the logs stop
arriving until the next build. That is the intended failure mode — it fails silent and harmless rather
than broadcasting to whatever is listening.

The addresses live in the *manifest*, never in the IR, so handing your project to someone else does not
carry your IP address with it.

## Using it

```bash
npm run logs                    # follow (Ctrl-C to stop)
npm run logs -- --for 20        # listen 20s then exit — the form to use in scripts
npm run logs -- --grep Arsist   # only matching lines
npm run logs -- --level error   # error and above
npm run logs -- --json          # one JSON object per line
npm run logs -- --port 9771     # another port (also ARSIST_LOG_PORT; default 9770)
```

The receiver is `scripts/arsist-logs.mjs`; the sender is `Runtime/Diagnostics/ArsistLogRelay.cs`.

Then launch the app on the headset. No cable, no `adb`, and the headset can stay on the user's head.

### For an agent

`--for N` exits on its own, so it can be run without a follow-up kill:

- exit `0` — lines were received
- exit `2` — nothing arrived in N seconds (app not running, different network, or relay disabled)
- exit `1` — the port could not be bound (socket error)

That distinction is the point: a silent zero-line run is otherwise indistinguishable from a crash.

```bash
npm run logs -- --for 25 --grep 'Arsist|Task' > /tmp/run.log; echo $?
```

## Turning it off

Ship builds should not stream logs over the LAN in plaintext. Set `arSettings.logRelay.enabled = false`
in a Layster.Virtual `project.json` (`arSettings.logRelay.port` changes the port); the pipeline then adds no
component and the manifest carries no addresses. Layster.Spatial builds go through the same builder;
`lower.ts` copies `app.logRelay` from `project.spatial.json` when it is set, otherwise the defaults apply. It is **on by
default** because the whole point is not having to configure anything while developing.

## Shape of a line

```json
{"token":"arsist","app":"ArsistPerception","level":"info","t":1792800000000,
 "msg":"[Arsist] Task 'scanView' -> \"…\"","stack":"…","dropped":3}
```

`stack` is present only when there is a stack trace, `dropped` only when lines were lost. `t` is **Unix time in
milliseconds** (`DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()`), so `new Date(t)` reads it directly. Builds made
before 2026-10 sent milliseconds since 0001-01-01 instead; `npm run logs` recognises those (`t > 1e13`) and converts
them.

`token` lets the receiver ignore unrelated traffic on the port. It is a filter, not a secret.

## Behaviour under load

The relay must never affect the app it is reporting on:

- Unity's log callback runs on **its own thread**; the relay only enqueues there and never touches a
  Unity API from it.
- Sending happens on a dedicated thread. UDP is fire-and-forget — nothing waits for a receiver, and a
  missing listener is not an error.
- The queue is capped at 512 entries; overflow drops the **oldest** and reports the count in the next
  line (`dropped`), so a burst is visibly truncated rather than silently lost.
- Individual messages (and stack traces) are truncated to 3500 characters so a long stack trace cannot blow the datagram.
