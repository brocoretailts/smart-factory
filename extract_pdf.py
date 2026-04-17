import PyPDF2
import os

def extract_text_from_pdf(pdf_path):
    with open(pdf_path, 'rb') as file:
        reader = PyPDF2.PdfReader(file)
        text = ""
        for page in reader.pages:
            text += page.extract_text()
    return text

if __name__ == "__main__":
    pdf_file = "program pabrik.pdf"
    if os.path.exists(pdf_file):
        content = extract_text_from_pdf(pdf_file)
        with open("pdf_content.txt", "w", encoding="utf-8", errors="replace") as f:
            f.write(content)
        print("Content extracted to pdf_content.txt")
    else:
        print(f"File {pdf_file} not found.")
