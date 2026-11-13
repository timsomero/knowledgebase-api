using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.RegularExpressions;
using System.Xml.Linq;
using KnowledgeBase.Api.Projects;

namespace KnowledgeBase.Api.Reports;

// The leadership report as a Word document (.docx), laid out like the owner's own status report:
//   Work Projects Status Report / the date
//   Overall Portfolio Health: a bullet per health ("11 On Track")
//   Executive Summary
//   ── then each project: its name, Area, Status (in its color), Target, Goal, Progress and
//      Next Steps and Risks (a bullet per sentence)
//   Update for CV Cloud Tech Slide: each executive update word for word.
// A .docx is a zip of a few XML files, so it is written here directly rather than with a library. The notes
// for you only (ForYou) are never in it.
public static partial class ReportDocument
{
    private static readonly XNamespace W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    private const string Font = "Calibri";

    private static readonly (ProjectHealth Health, string Name, string Color)[] Healths =
    [
        (ProjectHealth.OnTrack, "On Track", "1A7F37"),
        (ProjectHealth.NeedsAttention, "Needs Attention", "9A6700"),
        (ProjectHealth.Blocked, "Blocked", "D1242F"),
    ];

    public static string FileName(DateOnly date) => $"Status report {date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)}.docx";

    public static byte[] Build(DateOnly date, string summary, IReadOnlyList<ProjectReportItem> projects)
    {
        var body = new List<XElement>
        {
            Para([Run("Work Projects Status Report", bold: true, size: 28)]),
            Para([Run(date.ToString("MMMM d, yyyy", CultureInfo.InvariantCulture), bold: true, size: 24)]),
            Para([]),
            Heading("Overall Portfolio Health"),
        };
        foreach (var (health, name, _) in Healths)
            if (projects.Count(p => p.Health == health) is var n and > 0)
                body.Add(Bullet([Run($"{n} {name}", bold: true)]));

        body.Add(Para([]));
        body.Add(Heading("Executive Summary"));
        body.AddRange(Paragraphs(summary));

        foreach (var p in projects)
        {
            body.Add(Rule());
            body.Add(Para([Run(p.Name, bold: true, size: 24)]));
            if (!string.IsNullOrWhiteSpace(p.Category))
                body.Add(Para([Run("Area: ", bold: true), Run(p.Category)]));
            var (_, healthName, color) = Healths.First(h => h.Health == p.Health);
            body.Add(Para([Run("Status: ", bold: true), Run(healthName, bold: true, color: color)]));
            if (p.TargetDate is { } target)
                body.Add(Para([Run("Target: ", bold: true), Run(target.ToString("MMMM d, yyyy", CultureInfo.InvariantCulture))]));
            if (!string.IsNullOrWhiteSpace(p.Goal))
            {
                body.Add(Heading("Goal"));
                body.AddRange(Paragraphs(p.Goal));
            }
            Section(body, "Progress", p.Progress);
            Section(body, "Next Steps and Risks", p.Next);
        }

        var updates = projects.Where(p => !string.IsNullOrWhiteSpace(p.ExecutiveUpdate)).ToList();
        if (updates.Count > 0)
        {
            body.Add(Rule());
            body.Add(Para([Run("Update for CV Cloud Tech Slide", bold: true, size: 24)]));
            foreach (var p in updates)
            {
                body.Add(Para([Run(p.Name, bold: true)], spaceBefore: 120));
                body.AddRange(Paragraphs(p.ExecutiveUpdate));
            }
        }

        // Letter paper with 1" margins.
        body.Add(new XElement(W + "sectPr",
            new XElement(W + "pgSz", new XAttribute(W + "w", 12240), new XAttribute(W + "h", 15840)),
            new XElement(W + "pgMar", new XAttribute(W + "top", 1440), new XAttribute(W + "right", 1440), new XAttribute(W + "bottom", 1440),
                new XAttribute(W + "left", 1440), new XAttribute(W + "header", 720), new XAttribute(W + "footer", 720), new XAttribute(W + "gutter", 0))));

        var document = new XDocument(new XElement(W + "document", new XAttribute(XNamespace.Xmlns + "w", W), new XElement(W + "body", body)));
        return Zip(document);
    }

    // "Progress" and "Next Steps and Risks": a bullet per sentence (or per line, when written as lines).
    private static void Section(List<XElement> body, string title, string text)
    {
        var items = Items(text);
        if (items.Count == 0)
            return;
        body.Add(Heading(title));
        body.AddRange(items.Select(i => Bullet([Run(i)])));
    }

    private static List<string> Items(string text)
    {
        var lines = (text ?? "").Split('\n').Select(l => l.Trim().TrimStart('•', '-', '*').Trim()).Where(l => l.Length > 0).ToList();
        if (lines.Count > 1)
            return lines;
        return lines.SelectMany(l => SentenceBreak().Split(l)).Select(s => s.Trim()).Where(s => s.Length > 0).ToList();
    }

    [GeneratedRegex(@"(?<=[.!?])\s+(?=[A-Z0-9""“(])")]
    private static partial Regex SentenceBreak();

    private static IEnumerable<XElement> Paragraphs(string text) =>
        (text ?? "").Split('\n').Select(l => l.TrimEnd()).Where(l => l.Length > 0).Select(l => Para([Run(l)]));

    private static XElement Heading(string text) => Para([Run(text, bold: true)], spaceBefore: 120);

    private static XElement Para(IEnumerable<XElement> runs, int spaceBefore = 0, XElement? extra = null) =>
        new(W + "p",
            new XElement(W + "pPr",
                extra,
                new XElement(W + "spacing", new XAttribute(W + "before", spaceBefore), new XAttribute(W + "after", 40), new XAttribute(W + "line", 276), new XAttribute(W + "lineRule", "auto"))),
            runs);

    private static XElement Bullet(IEnumerable<XElement> runs) =>
        Para(runs, extra: new XElement(W + "numPr", new XElement(W + "ilvl", new XAttribute(W + "val", 0)), new XElement(W + "numId", new XAttribute(W + "val", 1))));

    // A thin line across the page between projects.
    private static XElement Rule() =>
        new(W + "p",
            new XElement(W + "pPr",
                new XElement(W + "pBdr", new XElement(W + "bottom", new XAttribute(W + "val", "single"), new XAttribute(W + "sz", 6), new XAttribute(W + "space", 1), new XAttribute(W + "color", "A0A0A0"))),
                new XElement(W + "spacing", new XAttribute(W + "before", 120), new XAttribute(W + "after", 160))));

    private static XElement Run(string text, bool bold = false, int size = 22, string? color = null) =>
        new(W + "r",
            new XElement(W + "rPr",
                bold ? new XElement(W + "b") : null,
                color is null ? null : new XElement(W + "color", new XAttribute(W + "val", color)),
                new XElement(W + "sz", new XAttribute(W + "val", size))),
            new XElement(W + "t", new XAttribute(XNamespace.Xml + "space", "preserve"), Clean(text)));

    // Characters XML can't hold (stray control characters from pasted text) are dropped.
    private static string Clean(string text) => new((text ?? "").Where(XmlConvertIsValid).ToArray());
    private static bool XmlConvertIsValid(char c) => c is '\t' or '\n' or '\r' || (c >= 0x20 && c != 0xFFFE && c != 0xFFFF);

    private static byte[] Zip(XDocument document)
    {
        using var stream = new MemoryStream();
        using (var zip = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            Add(zip, "[Content_Types].xml", """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
                  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
                  <Default Extension="xml" ContentType="application/xml"/>
                  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
                  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
                  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
                </Types>
                """);
            Add(zip, "_rels/.rels", """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
                </Relationships>
                """);
            Add(zip, "word/_rels/document.xml.rels", """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
                  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
                  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
                </Relationships>
                """);
            Add(zip, "word/styles.xml", $"""
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                  <w:docDefaults>
                    <w:rPrDefault><w:rPr><w:rFonts w:ascii="{Font}" w:hAnsi="{Font}" w:eastAsia="{Font}" w:cs="{Font}"/><w:sz w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>
                    <w:pPrDefault><w:pPr><w:spacing w:after="40" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault>
                  </w:docDefaults>
                  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
                </w:styles>
                """);
            Add(zip, "word/numbering.xml", """
                <?xml version="1.0" encoding="UTF-8" standalone="yes"?>
                <w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
                  <w:abstractNum w:abstractNumId="0">
                    <w:multiLevelType w:val="singleLevel"/>
                    <w:lvl w:ilvl="0">
                      <w:start w:val="1"/>
                      <w:numFmt w:val="bullet"/>
                      <w:lvlText w:val="•"/>
                      <w:lvlJc w:val="left"/>
                      <w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>
                      <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri"/></w:rPr>
                    </w:lvl>
                  </w:abstractNum>
                  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
                </w:numbering>
                """);
            var entry = zip.CreateEntry("word/document.xml", CompressionLevel.Optimal);
            using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
            document.Declaration = new XDeclaration("1.0", "UTF-8", "yes");
            document.Save(writer, SaveOptions.DisableFormatting);
        }
        return stream.ToArray();
    }

    private static void Add(ZipArchive zip, string name, string xml)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);
        using var writer = new StreamWriter(entry.Open(), new UTF8Encoding(false));
        writer.Write(xml.Trim());
    }
}
