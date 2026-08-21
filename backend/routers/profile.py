"""简历解析：上传 PDF / Word(docx) / TXT → 抽取文本。
仅内存处理、不落盘、不持久化；解析结果由前端存入 localStorage。
扫描版 PDF（无文字层）会返回明确错误并引导用户手填信息。
"""
import io

from fastapi import APIRouter, HTTPException, UploadFile

router = APIRouter(prefix="/api/profile", tags=["profile"])

MAX_BYTES = 5 * 1024 * 1024  # 5MB
MAX_TEXT = 8000              # 抽取文本上限（超出截断，防 prompt 膨胀）


def _extract_pdf(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _extract_docx(data: bytes) -> str:
    from docx import Document

    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs if p.text.strip()]
    for t in doc.tables:
        for row in t.rows:
            parts.append(" | ".join(c.text.strip() for c in row.cells))
    return "\n".join(parts)


@router.post("/extract")
async def extract_resume(file: UploadFile):
    data = await file.read()
    if len(data) > MAX_BYTES:
        raise HTTPException(status_code=400, detail="文件过大，请上传 5MB 以内的简历")

    name = (file.filename or "").lower()
    ext = name.rsplit(".", 1)[-1] if "." in name else ""
    try:
        if ext == "pdf":
            text = _extract_pdf(data)
        elif ext == "docx":
            text = _extract_docx(data)
        elif ext in ("txt", "md"):
            text = data.decode("utf-8", errors="replace")
        else:
            raise HTTPException(status_code=400, detail="仅支持 PDF / Word(docx) / TXT 格式")
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"解析失败：{str(exc)[:120]}")

    text = (text or "").strip()
    if not text:
        raise HTTPException(
            status_code=400,
            detail="未能从文件中提取到文字（可能是扫描件）。请改用文字版 PDF，或直接使用「手填信息」。",
        )
    return {
        "filename": file.filename,
        "ext": ext,
        "text": text[:MAX_TEXT],
        "chars": len(text[:MAX_TEXT]),
    }
