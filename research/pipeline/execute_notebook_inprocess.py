#!/usr/bin/env python3
"""Execute this repository's notebook using IPython without opening kernel sockets.

For restricted environments where Jupyter's TCP/IPC sockets are unavailable.
All code cells run in one fresh process; real rich outputs are saved to .ipynb.
A normal Jupyter Run All remains supported and is preferable interactively.
"""
from pathlib import Path
import argparse
import os
import sys
import time
import traceback

os.environ.setdefault("MPLCONFIGDIR", "/tmp/dna-mpl")
os.environ.setdefault("IPYTHONDIR", "/tmp/dna-ipython")
os.environ.setdefault("OPENBLAS_NUM_THREADS", "4")
import nbformat
from IPython.core.interactiveshell import InteractiveShell
from IPython.utils.capture import capture_output
import matplotlib
matplotlib.use("module://matplotlib_inline.backend_inline")
from matplotlib_inline.backend_inline import configure_inline_support


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("notebook", nargs="?", type=Path,
                        default=Path(__file__).resolve().parents[1] / "genes_mirror_geography_replication.ipynb",
                        help="Notebook to execute; defaults to the research draft.")
    path = parser.parse_args().notebook.resolve()
    os.chdir(path.parent)
    nb = nbformat.read(path, as_version=4)
    shell = InteractiveShell.instance()
    configure_inline_support(shell, "module://matplotlib_inline.backend_inline")
    count = 0
    for cell in nb.cells:
        if cell.cell_type == "code":
            cell.outputs = []
            cell.execution_count = None
    nb.metadata["execution_method"] = "Sequential IPython in-process execution; kernel sockets unavailable in managed environment"
    start = time.monotonic()
    for index, cell in enumerate(nb.cells):
        if cell.cell_type != "code": continue
        count += 1
        print(f"Executing code cell {count} (notebook cell {index+1})", flush=True)
        with capture_output(stdout=True, stderr=True, display=True) as captured:
            result = shell.run_cell(cell.source, store_history=True)
        cell.execution_count = count
        if captured.stdout:
            cell.outputs.append(nbformat.v4.new_output("stream", name="stdout", text=captured.stdout))
        if captured.stderr:
            cell.outputs.append(nbformat.v4.new_output("stream", name="stderr", text=captured.stderr))
        for output in captured.outputs:
            cell.outputs.append(nbformat.v4.new_output("display_data", data=output.data, metadata=output.metadata or {}))
        error = result.error_before_exec or result.error_in_exec
        if error:
            cell.outputs.append(nbformat.v4.new_output("error", ename=type(error).__name__, evalue=str(error),
                traceback=traceback.format_exception(type(error), error, error.__traceback__)))
            nbformat.write(nb,path)
            raise RuntimeError(f"Notebook cell {index+1} failed") from error
        nbformat.write(nb,path)
    nb.metadata["execution_seconds"] = round(time.monotonic()-start,2)
    nbformat.validate(nb)
    nbformat.write(nb,path)
    print(f"PASS: all {count} code cells executed, real outputs saved ({nb.metadata.execution_seconds}s)",flush=True)


if __name__ == "__main__":
    main()
