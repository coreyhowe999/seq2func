/*
 * =============================================================================
 * Merge Results Module — Unified Protein Annotation
 * =============================================================================
 *
 * This module is the final GATHER step that joins the three annotation
 * branches (CDD, ProstT5, FoldSeek) into a single unified JSON file.
 *
 * Author: Corey Howe
 * =============================================================================
 */

process MERGE_RESULTS {
    tag "${meta.id}"

    publishDir "${params.outdir}/${params.run_id}/annotations", mode: 'copy'

    input:
    tuple val(meta), path(proteins)
    tuple val(meta2), path(cdd_json)
    path(prostt5_3di)
    path(foldseek_json)

    output:
    tuple val(meta), path("annotations.json"),   emit: annotations
    tuple val(meta), path("summary_table.tsv"),  emit: summary
    path("versions.yml"),                        emit: versions

    script:
    """
    #!/usr/bin/env python3
    import json, re, sys, os

    def parse_fasta(path):
        proteins = []
        header, seq = "", []
        with open(path) as f:
            for line in f:
                line = line.strip()
                if line.startswith(">"):
                    if header:
                        proteins.append((header, "".join(seq)))
                    header = line[1:]
                    seq = []
                elif line:
                    seq.append(line)
            if header:
                proteins.append((header, "".join(seq)))
        return proteins

    def load_json(path):
        if not os.path.exists(path) or os.path.basename(path).startswith("NO_"):
            return {}
        try:
            with open(path) as f:
                return json.load(f)
        except:
            return {}

    def load_3di(path):
        if not os.path.exists(path) or os.path.basename(path).startswith("NO_"):
            return {}
        result = {}
        try:
            for h, s in parse_fasta(path):
                result[h.split()[0]] = s
        except:
            pass
        return result

    proteins = parse_fasta("${proteins}")
    cdd = load_json("${cdd_json}")
    prostt5 = load_3di("${prostt5_3di}")
    foldseek = load_json("${foldseek_json}")

    annotations = []
    for header, sequence in proteins:
        pid = header.split()[0]
        orf_match = re.search(r"type:(\\w+)", header)
        orf_type = orf_match.group(1) if orf_match else "unknown"
        tid = pid.rsplit(".p", 1)[0] if ".p" in pid else pid
        seq_clean = sequence.rstrip("*")

        cdd_entry = cdd.get(pid, {"domains": [], "sites": []})
        p3di = prostt5.get(pid, "")
        fs_entry = foldseek.get(pid, {"hits": []})

        annotations.append({
            "protein_id": pid,
            "sequence": seq_clean,
            "length": len(seq_clean),
            "orf_type": orf_type,
            "transcript_id": tid,
            "cdd": cdd_entry,
            "prostt5": {"sequence_3di": p3di, "has_prediction": bool(p3di)},
            "foldseek": fs_entry,
        })

    annotations.sort(key=lambda a: a["length"], reverse=True)

    with open("annotations.json", "w") as f:
        json.dump(annotations, f, indent=2)

    with open("summary_table.tsv", "w") as f:
        f.write("protein_id\\tlength\\torf_type\\tnum_domains\\ttop_domain\\ttop_foldseek_hit\\ttop_foldseek_evalue\\n")
        for a in annotations:
            domains = a["cdd"].get("domains", [])
            hits = a["foldseek"].get("hits", [])
            f.write("\\t".join([
                a["protein_id"], str(a["length"]), a["orf_type"],
                str(len(domains)),
                domains[0]["name"] if domains else "None",
                hits[0]["target_name"] if hits else "None",
                f"{hits[0]['evalue']:.2e}" if hits else "N/A",
            ]) + "\\n")

    print(f"Merged {len(annotations)} proteins", file=sys.stderr)

    with open("versions.yml", "w") as f:
        f.write('"${task.process}":\\n  merge_annotations: "1.0"\\n')
    """
}
