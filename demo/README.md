# DevStation demo, in nine chapters

A 3:00 walkthrough of DevStation, cut as nine 20-second films so they can be joined later. Play `chapters/` in filename order.

| File | Time | Chapter |
| --- | --- | --- |
| `01-open.mp4` | 0:00–0:20 | Landing. Deploy. Debug. Analyze. Inspect. |
| `02-terminal.mp4` | 0:20–0:40 | The DevStation CLI, on your machine. |
| `03-launchkit.mp4` | 0:40–1:00 | LaunchKit templates on the marketplace. |
| `04-editor.mp4` | 1:00–1:20 | Contract Editor. solc in the browser. |
| `05-agent.mp4` | 1:20–1:40 | Code with AI, from a sentence to a signature. |
| `06-deploy.mp4` | 1:40–2:00 | Deploy, then My Projects on the ProjectRegistry. |
| `07-routebook.mp4` | 2:00–2:20 | Routebook and the Label Registry. |
| `08-explorer.mp4` | 2:20–2:40 | Explorer on QIE and BOT Chain. |
| `09-close.mp4` | 2:40–3:00 | Connect, build, deploy, inspect. |

Every file is 1920×1080, 30 fps, H.264 and AAC, exactly 20 seconds. The music bed is continuous across the cut points.

The StakingVault lines and `0x7f3a…c19b` are the demo already drawn on the landing page, not a live transaction.

## Join them

From `demo/chapters/`:

```sh
ffmpeg -f concat -safe 0 -i concat.txt -c copy ../devstation-demo.mp4
```

That writes `demo/devstation-demo.mp4` at 3:00 without re-encoding the picture. FFmpeg may warn about audio timestamps at the chapter boundaries. If a player stumbles there, re-encode the audio only:

```sh
ffmpeg -f concat -safe 0 -i concat.txt -c:v copy -c:a aac -b:a 192k ../devstation-demo.mp4
```
