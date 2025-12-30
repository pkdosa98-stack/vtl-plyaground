# vtl-plyaground

A minimal Velocity-inspired template renderer that keeps Java-style integer math semantics.

## Development

- Install dependencies (none beyond Node.js). The repository uses the built-in `node:test` runner.
- Run tests: `npm test`

## Example

```text
#set($Integer = 0)
#set($result = "Idle")
#if($pswLastChangedTime == "")
$result
#else
#set($nowYear = $Integer.parseInt($nowTime) / 10000)
#set($nowMonth = ($Integer.parseInt($nowTime) % 10000) / 100)
#set($nowDay = $Integer.parseInt($nowTime) % 100)
#set($pswYear = $Integer.parseInt($pswLastChangedTime) / 10000)
#set($pswMonth = ($Integer.parseInt($pswLastChangedTime) % 10000) / 100)
#set($pswDay = $Integer.parseInt($pswLastChangedTime) % 100)
#set($nowDays = ($nowYear * 365) + ($nowMonth * 30) + $nowDay)
#set($pswDays = ($pswYear * 365) + ($pswMonth * 30) + $pswDay)
#set($diffInDays = ($nowDays - $pswDays))
#if($diffInDays >= 1 && $diffInDays <= 11)
#set($result = $diffInDays)
#end
#end
$result
```

Rendering the above with `nowTime = 251229` and `pswLastChangedTime = 251221` outputs `8`.
