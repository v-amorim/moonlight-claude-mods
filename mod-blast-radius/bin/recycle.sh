#!/bin/sh
# Stands in for rm: sends its paths to the OS bin, and with no bin it leaves them in place and exits 1, never deleting for good.
here=$(cd "$(dirname "$0")" && pwd)
status=0
recursive=0
force=0
named=0

for arg in "$@"; do
  case $arg in
    --recursive) recursive=1 ;;
    --force) force=1 ;;
    --) break ;;
    --*) ;;
    -[a-zA-Z]*)
      case $arg in -*[rR]*) recursive=1 ;; esac
      case $arg in -*f*) force=1 ;; esac
      ;;
  esac
done

opts=1
count=$#
while [ "$count" -gt 0 ]; do
  arg=$1
  shift
  count=$((count - 1))
  if [ "$opts" = 1 ]; then
    case $arg in
      --) opts=0; continue ;;
      --*|-[a-zA-Z]*) continue ;;
    esac
  fi
  named=1
  if [ ! -e "$arg" ] && [ ! -L "$arg" ]; then
    if [ "$force" = 0 ]; then
      echo "rm: cannot remove '$arg': No such file or directory" >&2
      status=1
    fi
    continue
  fi
  if [ -d "$arg" ] && [ ! -L "$arg" ] && [ "$recursive" = 0 ]; then
    echo "rm: cannot remove '$arg': Is a directory" >&2
    status=1
    continue
  fi
  set -- "$@" "$arg"
done

if [ "$named" = 0 ]; then
  [ "$force" = 1 ] && exit 0
  echo "rm: missing operand" >&2
  exit 1
fi
[ "$#" -gt 0 ] || exit "$status"

# Absolute and without a trailing slash, so no path reads as an option and none ends in a backslash.
count=$#
while [ "$count" -gt 0 ]; do
  path=$1
  shift
  count=$((count - 1))
  while [ "${#path}" -gt 1 ] && [ "${path%/}" != "$path" ]; do path=${path%/}; done
  case $path in
    /*|[a-zA-Z]:*) ;;
    *) path="$PWD/$path" ;;
  esac
  set -- "$@" "$path"
done

case $(uname -s 2>/dev/null) in
  MINGW*|MSYS*|CYGWIN*)
    count=$#
    while [ "$count" -gt 0 ]; do
      path=$1
      shift
      count=$((count - 1))
      set -- "$@" "$(cygpath -aw -- "$path")"
    done
    MSYS2_ARG_CONV_EXCL='*' powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$(cygpath -w "$here/recycle.ps1")" "$@" || status=1
    ;;
  Darwin)
    if command -v trash >/dev/null 2>&1; then
      trash "$@" || status=1
    elif command -v osascript >/dev/null 2>&1; then
      for path in "$@"; do
        osascript -e 'on run argv' -e 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)' -e 'end run' "$path" >/dev/null || status=1
      done
    else
      echo "rm (to the bin): neither trash nor osascript is available, so nothing was removed" >&2
      status=1
    fi
    ;;
  *)
    if command -v gio >/dev/null 2>&1; then
      gio trash -- "$@" || status=1
    else
      echo "rm (to the bin): gio is not available, so nothing was removed" >&2
      status=1
    fi
    ;;
esac
exit "$status"
