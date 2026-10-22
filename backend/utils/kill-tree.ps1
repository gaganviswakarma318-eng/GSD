# Read by Node and passed as an encoded command so this also works inside ASAR.
# Toolhelp uses the kernel snapshot API, avoiding taskkill's dependency on WMI.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
public static class GsdProcessTree {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct Entry {
    public uint size, usage, processId;
    public UIntPtr heap;
    public uint moduleId, threads, parentId;
    public int priority;
    public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string filename;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint id);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32FirstW(IntPtr handle, ref Entry entry);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool Process32NextW(IntPtr handle, ref Entry entry);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  public static void Kill(int root) {
    if (root <= 4 || root == Process.GetCurrentProcess().Id) throw new ArgumentException("Invalid process ID");
    var children = new Dictionary<int, List<int>>();
    IntPtr snapshot = CreateToolhelp32Snapshot(2, 0);
    if (snapshot == new IntPtr(-1)) throw new InvalidOperationException("Unable to inspect process tree");
    try {
      var entry = new Entry(); entry.size = (uint)Marshal.SizeOf(typeof(Entry));
      bool found = Process32FirstW(snapshot, ref entry);
      while (found) {
        int parent = (int)entry.parentId;
        if (!children.ContainsKey(parent)) children[parent] = new List<int>();
        children[parent].Add((int)entry.processId);
        found = Process32NextW(snapshot, ref entry);
      }
    } finally { CloseHandle(snapshot); }
    var seen = new HashSet<int>();
    KillBranch(root, children, seen);
  }
  static void KillBranch(int id, Dictionary<int, List<int>> children, HashSet<int> seen) {
    if (!seen.Add(id)) return;
    if (children.ContainsKey(id)) foreach (int child in children[id]) KillBranch(child, children, seen);
    try { using (var process = Process.GetProcessById(id)) { process.Kill(); process.WaitForExit(3000); } }
    catch (ArgumentException) { }
    catch (InvalidOperationException) { }
  }
}
'@
[GsdProcessTree]::Kill(__GSD_PROCESS_ID__)
