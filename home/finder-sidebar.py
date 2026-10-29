#!/usr/bin/env python3
"""List / add / remove Finder sidebar Favorites through LSSharedFileList (no Full Disk Access needed).

usage: sidebar.py list
       sidebar.py add "<Display name>" /abs/path   [--first]
       sidebar.py remove "<Display name or /abs/path>"
"""
import ctypes, ctypes.util, sys, os

CF = ctypes.CDLL(ctypes.util.find_library("CoreFoundation"))
CS = ctypes.CDLL("/System/Library/Frameworks/CoreServices.framework/CoreServices")

CFIndex = ctypes.c_long
CFTypeRef = ctypes.c_void_p
kCFStringEncodingUTF8 = 0x08000100

CF.CFStringCreateWithCString.restype = CFTypeRef
CF.CFStringCreateWithCString.argtypes = [CFTypeRef, ctypes.c_char_p, ctypes.c_uint32]
CF.CFStringGetCString.restype = ctypes.c_bool
CF.CFStringGetCString.argtypes = [CFTypeRef, ctypes.c_char_p, CFIndex, ctypes.c_uint32]
CF.CFArrayGetCount.restype = CFIndex
CF.CFArrayGetCount.argtypes = [CFTypeRef]
CF.CFArrayGetValueAtIndex.restype = CFTypeRef
CF.CFArrayGetValueAtIndex.argtypes = [CFTypeRef, CFIndex]
CF.CFURLCopyFileSystemPath.restype = CFTypeRef
CF.CFURLCopyFileSystemPath.argtypes = [CFTypeRef, CFIndex]
CF.CFURLCreateWithFileSystemPath.restype = CFTypeRef
CF.CFURLCreateWithFileSystemPath.argtypes = [CFTypeRef, CFTypeRef, CFIndex, ctypes.c_bool]
CF.CFRelease.argtypes = [CFTypeRef]

CS.LSSharedFileListCreate.restype = CFTypeRef
CS.LSSharedFileListCreate.argtypes = [CFTypeRef, CFTypeRef, CFTypeRef]
CS.LSSharedFileListCopySnapshot.restype = CFTypeRef
CS.LSSharedFileListCopySnapshot.argtypes = [CFTypeRef, ctypes.POINTER(ctypes.c_uint32)]
CS.LSSharedFileListItemCopyDisplayName.restype = CFTypeRef
CS.LSSharedFileListItemCopyDisplayName.argtypes = [CFTypeRef]
CS.LSSharedFileListItemCopyResolvedURL.restype = CFTypeRef
CS.LSSharedFileListItemCopyResolvedURL.argtypes = [CFTypeRef, ctypes.c_uint32, CFTypeRef]
CS.LSSharedFileListInsertItemURL.restype = CFTypeRef
CS.LSSharedFileListInsertItemURL.argtypes = [CFTypeRef, CFTypeRef, CFTypeRef, CFTypeRef, CFTypeRef, CFTypeRef, CFTypeRef]
CS.LSSharedFileListItemRemove.restype = ctypes.c_int32
CS.LSSharedFileListItemRemove.argtypes = [CFTypeRef, CFTypeRef]

kBeforeFirst = ctypes.c_void_p.in_dll(CS, "kLSSharedFileListItemBeforeFirst")
kLast = ctypes.c_void_p.in_dll(CS, "kLSSharedFileListItemLast")


def cfstr(s):
    return CF.CFStringCreateWithCString(None, s.encode("utf-8"), kCFStringEncodingUTF8)


def pystr(ref):
    if not ref:
        return None
    buf = ctypes.create_string_buffer(4096)
    ok = CF.CFStringGetCString(ref, buf, 4096, kCFStringEncodingUTF8)
    return buf.value.decode("utf-8") if ok else None


def favorites():
    return CS.LSSharedFileListCreate(None, cfstr("com.apple.LSSharedFileList.FavoriteItems"), None)


def snapshot(lst):
    seed = ctypes.c_uint32(0)
    arr = CS.LSSharedFileListCopySnapshot(lst, ctypes.byref(seed))
    items = []
    for i in range(CF.CFArrayGetCount(arr)):
        it = CF.CFArrayGetValueAtIndex(arr, i)
        name = pystr(CS.LSSharedFileListItemCopyDisplayName(it))
        url = CS.LSSharedFileListItemCopyResolvedURL(it, 0x100 | 0x400, None)  # no UI, don't mount
        path = pystr(CF.CFURLCopyFileSystemPath(url, 0)) if url else None
        items.append((it, name, path))
    return items


def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else "list"
    lst = favorites()
    if cmd == "list":
        for _, name, path in snapshot(lst):
            print(f"{name!s:28s} -> {path}")
    elif cmd == "add":
        name, path = sys.argv[2], sys.argv[3]
        url = CF.CFURLCreateWithFileSystemPath(None, cfstr(path), 0, True)
        where = kBeforeFirst if "--first" in sys.argv else kLast
        it = CS.LSSharedFileListInsertItemURL(lst, where, cfstr(name), None, url, None, None)
        print("added" if it else "FAILED", name, path)
    elif cmd == "remove":
        target = sys.argv[2]
        n = 0
        for it, name, path in snapshot(lst):
            if name == target or path == target:
                rc = CS.LSSharedFileListItemRemove(lst, it)
                print("removed" if rc == 0 else f"FAILED rc={rc}", name, path)
                n += 1
        if n == 0:
            print("no match for", target)


if __name__ == "__main__":
    main()
