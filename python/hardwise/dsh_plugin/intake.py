"""Workspace-confined local file intake; compare only the bytes copied into this run."""

from pathlib import Path
from tempfile import TemporaryDirectory

from pydantic import BaseModel, ConfigDict, Field

from hardwise.revision.engine import compare_files
from hardwise.revision.netlist_source import netlist_files
from hardwise.revision.server import MAX_FILE_BYTES


class CompareRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    before_netlist: str = Field(min_length=1)
    before_bom: str = Field(min_length=1)
    after_netlist: str = Field(min_length=1)
    after_bom: str = Field(min_length=1)
    label: str = Field(default="工程改版比较", min_length=1, max_length=160)


def confined(workspace: Path, path: str) -> Path:
    candidate = (workspace / path).resolve(strict=True)
    if not candidate.is_relative_to(workspace.resolve()):
        raise ValueError("输入必须位于当前 DSH 工作目录内。")
    return candidate


def compare_local(workspace: Path, request: CompareRequest):
    paths = [
        confined(workspace, getattr(request, role))
        for role in ("before_netlist", "before_bom", "after_netlist", "after_bom")
    ]
    with TemporaryDirectory(prefix="hardwise-dsh-input-") as temporary:
        copied = []
        for index, source in enumerate(paths):
            files = netlist_files(source) if index % 2 == 0 else [source]
            target = Path(temporary) / str(index)
            target.mkdir()
            for file in files:
                safe = confined(workspace, str(file))
                if not safe.is_file():
                    raise ValueError("输入必须是普通文件。")
                with safe.open("rb") as stream:
                    content = stream.read(MAX_FILE_BYTES + 1)
                if not content.strip() or len(content) > MAX_FILE_BYTES:
                    raise ValueError("每个输入必须非空且不超过 10 MiB。")
                (target / file.name).write_bytes(content)
            copied.append(target if source.is_dir() else target / source.name)
        return compare_files(*copied)
