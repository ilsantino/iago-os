import sys, win32com.client
src, dst = sys.argv[1], sys.argv[2]
w = win32com.client.DispatchEx("Word.Application"); w.Visible = False
d = w.Documents.Open(src, ReadOnly=True)
d.ExportAsFixedFormat(dst, 17)
print("pages", d.ComputeStatistics(2))
d.Close(False); w.Quit()
