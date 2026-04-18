import type { PipelineRun, PipelineStep, ProteinAnnotation, LogEntry } from "./types";

export const mockRun: PipelineRun = {
  id: "run_20240315_120000",
  srrId: "SRR5437876",
  sampleName: "Arabidopsis Drought Stress",
  organism: "Arabidopsis thaliana",
  libraryLayout: "PAIRED",
  totalReads: 2000000,
  totalBases: 300000000,
  platform: "ILLUMINA",
  studyTitle: "RNA-seq of Arabidopsis thaliana seedlings under drought stress",
  createdAt: "2024-03-15T12:00:00Z",
  updatedAt: "2024-03-15T12:45:00Z",
  status: "completed",
  totalContigs: 12345,
  totalProteins: 342,
  n50: 890,
  errorMessage: null,
};

export const mockSteps: PipelineStep[] = [
  { id: 1, runId: "run_20240315_120000", stepName: "SRA_DOWNLOAD", status: "completed", startedAt: "2024-03-15T12:00:00Z", completedAt: "2024-03-15T12:05:30Z", metrics: JSON.stringify({ total_reads: 2000000, total_bases: 300000000 }) },
  { id: 2, runId: "run_20240315_120000", stepName: "FASTQC", status: "completed", startedAt: "2024-03-15T12:05:31Z", completedAt: "2024-03-15T12:06:45Z", metrics: null },
  { id: 3, runId: "run_20240315_120000", stepName: "TRIMMOMATIC", status: "completed", startedAt: "2024-03-15T12:06:46Z", completedAt: "2024-03-15T12:09:20Z", metrics: JSON.stringify({ reads_surviving: 1850000, percent_surviving: 92.5 }) },
  { id: 4, runId: "run_20240315_120000", stepName: "FASTQC_TRIMMED", status: "completed", startedAt: "2024-03-15T12:09:21Z", completedAt: "2024-03-15T12:10:15Z", metrics: null },
  { id: 5, runId: "run_20240315_120000", stepName: "TRINITY", status: "completed", startedAt: "2024-03-15T12:10:16Z", completedAt: "2024-03-15T12:35:00Z", metrics: JSON.stringify({ num_contigs: 12345, n50: 890, total_assembled_bases: 8500000 }) },
  { id: 6, runId: "run_20240315_120000", stepName: "TRANSDECODER_LONGORFS", status: "completed", startedAt: "2024-03-15T12:35:01Z", completedAt: "2024-03-15T12:36:30Z", metrics: JSON.stringify({ total_orfs: 5200 }) },
  { id: 7, runId: "run_20240315_120000", stepName: "TRANSDECODER_PREDICT", status: "completed", startedAt: "2024-03-15T12:36:31Z", completedAt: "2024-03-15T12:37:45Z", metrics: JSON.stringify({ predicted_proteins: 342 }) },
  { id: 8, runId: "run_20240315_120000", stepName: "CDD_SEARCH", status: "completed", startedAt: "2024-03-15T12:37:46Z", completedAt: "2024-03-15T12:42:00Z", metrics: JSON.stringify({ proteins_with_domains: 198, total_domains: 312 }) },
  { id: 9, runId: "run_20240315_120000", stepName: "PROSTT5_PREDICT", status: "completed", startedAt: "2024-03-15T12:37:46Z", completedAt: "2024-03-15T12:40:30Z", metrics: JSON.stringify({ predictions: 340 }) },
  { id: 10, runId: "run_20240315_120000", stepName: "FOLDSEEK_SEARCH", status: "completed", startedAt: "2024-03-15T12:40:31Z", completedAt: "2024-03-15T12:43:15Z", metrics: JSON.stringify({ proteins_with_hits: 256, total_hits: 1280 }) },
  { id: 11, runId: "run_20240315_120000", stepName: "MERGE_RESULTS", status: "completed", startedAt: "2024-03-15T12:43:16Z", completedAt: "2024-03-15T12:43:45Z", metrics: JSON.stringify({ total_annotated: 342 }) },
];

const DOMAIN_COLORS = [
  "#4F46E5", "#DC2626", "#059669", "#D97706", "#7C3AED",
  "#DB2777", "#0891B2", "#65A30D", "#EA580C", "#6366F1",
];

export const mockProteins: ProteinAnnotation[] = [
  {
    protein_id: "TRINITY_DN100_c0_g1_i1.p1",
    sequence: "MKVLWAALLVTFLAGCQAKVEQAVETEPEPELRQQTEWQSGQRWELALGRFWDYLRWVQTLSEQVQEELLSSQVTQELRALMDETMKELKAYKSELEEQLTPVAEETRARLSKELQAAQARLGADVLASHGRLVQYRGEVQAMLGQSTEELRVRLASHLRKLRKRLLRDADDLQKRLAVYQAGAREGAERGLSAIRERLGPLVEQGRVRAATVGSLAGQPLQERAQAWGERLRARMEEMGSRTRDRLDEVKEQVAEVRAKLEEQAQQIRLQAEIFQARLKLMEARPESHAVDKLAACYAHLAEPRRPIPAPPNLHTSAGQRFAYRA",
    length: 342,
    orf_type: "complete",
    transcript_id: "TRINITY_DN100_c0_g1_i1",
    cdd: {
      domains: [
        { accession: "cd00180", name: "Pkinase", description: "Protein kinase catalytic domain", superfamily: "cl21453", evalue: 1.2e-45, bitscore: 165.3, from: 15, to: 280 },
        { accession: "cd00192", name: "SH3_domain", description: "Src homology 3 domain", superfamily: "cl17036", evalue: 3.5e-12, bitscore: 52.1, from: 285, to: 340 },
      ],
      sites: [
        { type: "active_site", residues: ["D166", "H168", "N171"], description: "Catalytic loop (HRD motif)" },
        { type: "binding_site", residues: ["K72", "E91"], description: "ATP binding site" },
      ],
    },
    prostt5: { sequence_3di: "dddddvlvvccccddddpppppvvvvlllllccccddddpppppvvvlldddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlllddddcccpppvvvlll", has_prediction: true },
    foldseek: {
      hits: [
        { target_id: "1ATP_E", target_name: "cAMP-dependent protein kinase catalytic subunit", identity: 0.42, evalue: 3.2e-35, alignment_length: 270, taxonomy: "Mus musculus" },
        { target_id: "2SRC_A", target_name: "Proto-oncogene tyrosine-protein kinase Src", identity: 0.38, evalue: 1.5e-28, alignment_length: 265, taxonomy: "Homo sapiens" },
        { target_id: "3LCK_A", target_name: "Tyrosine-protein kinase Lck", identity: 0.35, evalue: 8.7e-25, alignment_length: 260, taxonomy: "Homo sapiens" },
      ],
    },
  },
  {
    protein_id: "TRINITY_DN200_c0_g1_i1.p1",
    sequence: "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH",
    length: 147,
    orf_type: "complete",
    transcript_id: "TRINITY_DN200_c0_g1_i1",
    cdd: {
      domains: [
        { accession: "cd08927", name: "Globin", description: "Globin family domain", superfamily: "cl21461", evalue: 2.3e-52, bitscore: 180.5, from: 1, to: 141 },
      ],
      sites: [
        { type: "binding_site", residues: ["H58", "H87"], description: "Heme iron coordination" },
        { type: "binding_site", residues: ["E7", "V62", "F43", "L91"], description: "Heme pocket residues" },
      ],
    },
    prostt5: { sequence_3di: "ccccddddvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllcccc", has_prediction: true },
    foldseek: {
      hits: [
        { target_id: "4HHB_A", target_name: "Hemoglobin subunit alpha", identity: 0.85, evalue: 1.0e-60, alignment_length: 141, taxonomy: "Homo sapiens" },
        { target_id: "1MBO_A", target_name: "Myoglobin", identity: 0.45, evalue: 2.1e-30, alignment_length: 140, taxonomy: "Physeter macrocephalus" },
      ],
    },
  },
  {
    protein_id: "TRINITY_DN300_c0_g1_i1.p1",
    sequence: "MRGSHHHHHHTDPALRARLLALAGLLGALLAAPARAGHVEVPFGIGSELSALRPPGPLRPRGPWFATPDLELRERAVRLALRGRGLAEDVLAKLAKLSRIADEFSRGFLAACGDDALVAQLQRALTEVLKADPKAKERLNRLLEELKEKDQRQRVAQAREQLRAQLDEEKARLREALERMSAK",
    length: 178,
    orf_type: "5prime_partial",
    transcript_id: "TRINITY_DN300_c0_g1_i1",
    cdd: {
      domains: [
        { accession: "cd00036", name: "LRR_RI", description: "Leucine-rich repeat ribonuclease inhibitor-like", superfamily: "cl38944", evalue: 1.2e-15, bitscore: 89.3, from: 45, to: 165 },
      ],
      sites: [],
    },
    prostt5: { sequence_3di: "dddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddccc", has_prediction: true },
    foldseek: {
      hits: [
        { target_id: "2BNH_A", target_name: "Ribonuclease inhibitor", identity: 0.52, evalue: 5.6e-20, alignment_length: 120, taxonomy: "Sus scrofa" },
      ],
    },
  },
  {
    protein_id: "TRINITY_DN400_c0_g1_i1.p1",
    sequence: "MASWSHPQFEKGAPVFHIRSEVLAGHNLPKNVLINKGEEVTIHVNAKGELCAGINSVPMVTFNKNESLKDSYLEVDKDGKPVSFHIEQKELSGKLSFHTPHHKEVTLHQLKQNGKVVNLSKGEGHTLNVRRK",
    length: 132,
    orf_type: "complete",
    transcript_id: "TRINITY_DN400_c0_g1_i1",
    cdd: {
      domains: [
        { accession: "cd00099", name: "Ig", description: "Immunoglobulin domain", superfamily: "cl11960", evalue: 4.1e-18, bitscore: 72.8, from: 5, to: 95 },
        { accession: "cd00099", name: "Ig", description: "Immunoglobulin domain (C-terminal)", superfamily: "cl11960", evalue: 8.2e-10, bitscore: 45.2, from: 98, to: 130 },
      ],
      sites: [],
    },
    prostt5: { sequence_3di: "ccccddddvvvllldddcccpppvvvllldddcccpppvvvllldddcccpppvvvllldddcccpppvvvllldddcccpppvvvllldddcccpppvvvllldddcccpppvvvllld", has_prediction: true },
    foldseek: {
      hits: [
        { target_id: "1IGT_A", target_name: "Immunoglobulin G1", identity: 0.35, evalue: 2.1e-15, alignment_length: 90, taxonomy: "Mus musculus" },
        { target_id: "1TET_A", target_name: "Twitchin Ig domain", identity: 0.28, evalue: 5.5e-10, alignment_length: 88, taxonomy: "Caenorhabditis elegans" },
      ],
    },
  },
  {
    protein_id: "TRINITY_DN500_c0_g1_i1.p1",
    sequence: "MTEQMTLRGTFKKVFQEAHRDEKEAAFQIINQMKHQHAQQQPAWMLKQNPALHQFSMLIQLIADVASEDPYRGMIERFIAQFNVFQTSHVSQALGILLKPHEDEIKKILHQLGLHPILENVSDPATLARASQP",
    length: 133,
    orf_type: "complete",
    transcript_id: "TRINITY_DN500_c0_g1_i1",
    cdd: {
      domains: [
        { accession: "cd00079", name: "HATPase_c", description: "Histidine kinase-like ATPase, C-terminal domain", superfamily: "cl17040", evalue: 6.7e-22, bitscore: 85.6, from: 10, to: 120 },
      ],
      sites: [
        { type: "active_site", residues: ["D79", "G83", "G85"], description: "ATP hydrolysis residues" },
      ],
    },
    prostt5: { sequence_3di: "", has_prediction: false },
    foldseek: { hits: [] },
  },
  {
    protein_id: "TRINITY_DN600_c0_g1_i1.p1",
    sequence: "MKNKFKTQEELVNHLKTVGDVTQETFLNHLNATFSGKEILEQKIDNLQQELERLSTPEDVKNWLDSLQDKFSTGRINLNHPQFDRDDYWAMKPGVSPEDLMYELLQREAEQPETEKQHILERANELFAGEDLSEWRAKLQALKERGESFL",
    length: 149,
    orf_type: "3prime_partial",
    transcript_id: "TRINITY_DN600_c0_g1_i1",
    cdd: {
      domains: [],
      sites: [],
    },
    prostt5: { sequence_3di: "dddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllld", has_prediction: true },
    foldseek: {
      hits: [
        { target_id: "3BSE_A", target_name: "Uncharacterized protein", identity: 0.22, evalue: 1.2e-5, alignment_length: 100, taxonomy: "Arabidopsis thaliana" },
      ],
    },
  },
  {
    protein_id: "TRINITY_DN700_c0_g1_i1.p1",
    sequence: "MSIFETKVEQHYIDKWRTIGELQEALVHKAISQPDLEFVKEVLQKNAAKMDGFKADFFIDKATFNKMSLEEHHLAAHRPFIFGEPRYRYVAHAVKALNPSRFNEQFLRHIQSPHVFAECKVQQLVEHYRKMNAEKLQKLEEKYNR",
    length: 143,
    orf_type: "complete",
    transcript_id: "TRINITY_DN700_c0_g1_i1",
    cdd: {
      domains: [
        { accession: "cd00083", name: "HLH", description: "Helix-loop-helix domain", superfamily: "cl02536", evalue: 2.8e-20, bitscore: 78.4, from: 25, to: 80 },
      ],
      sites: [],
    },
    prostt5: { sequence_3di: "ccccddddvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddppppvvvvllllccccddddpp", has_prediction: true },
    foldseek: {
      hits: [
        { target_id: "1AN2_A", target_name: "Max protein (basic HLH-LZ)", identity: 0.40, evalue: 8.3e-18, alignment_length: 55, taxonomy: "Homo sapiens" },
      ],
    },
  },
  {
    protein_id: "TRINITY_DN800_c0_g1_i1.p1",
    sequence: "MAQKPMVRTALTFRASFRRGVLPMFAAAQSRPNAVSEYLKDELLKLGGSFTTWDQHSTTQQSYLDSGIHSGATTTAPSLSGKGNPEEEDVDTSQVLYEWEQGFSQSFTQEQVADIDGQYAM",
    length: 120,
    orf_type: "internal",
    transcript_id: "TRINITY_DN800_c0_g1_i1",
    cdd: {
      domains: [
        { accession: "cd00031", name: "WD40", description: "WD40 repeat domain", superfamily: "cl02567", evalue: 9.1e-8, bitscore: 38.2, from: 30, to: 110 },
      ],
      sites: [],
    },
    prostt5: { sequence_3di: "dddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvllldddcccvvvlll", has_prediction: true },
    foldseek: { hits: [] },
  },
];

export const mockLogs: LogEntry[] = [
  { id: 1, runId: "run_20240315_120000", timestamp: "2024-03-15T12:00:01Z", level: "info", source: "nextflow", message: "N E X T F L O W  ~  version 25.10.4" },
  { id: 2, runId: "run_20240315_120000", timestamp: "2024-03-15T12:00:02Z", level: "info", source: "nextflow", message: "Launching `main.nf` [amazing_turing] DSL2 - revision: ef94d835a8" },
  { id: 3, runId: "run_20240315_120000", timestamp: "2024-03-15T12:00:03Z", level: "info", source: "nextflow", message: "executor >  local (2)" },
  { id: 4, runId: "run_20240315_120000", timestamp: "2024-03-15T12:00:10Z", level: "info", source: "step:SRA_DOWNLOAD", message: "Prefetching SRR5437876 from NCBI SRA..." },
  { id: 5, runId: "run_20240315_120000", timestamp: "2024-03-15T12:03:30Z", level: "info", source: "step:SRA_DOWNLOAD", message: "Downloaded 2,000,000 reads (300 MB)" },
  { id: 6, runId: "run_20240315_120000", timestamp: "2024-03-15T12:05:30Z", level: "info", source: "step:SRA_DOWNLOAD", message: "SRA download complete. Layout: PAIRED, Platform: ILLUMINA" },
  { id: 7, runId: "run_20240315_120000", timestamp: "2024-03-15T12:05:31Z", level: "info", source: "step:FASTQC", message: "Running FastQC on raw reads..." },
  { id: 8, runId: "run_20240315_120000", timestamp: "2024-03-15T12:06:45Z", level: "info", source: "step:FASTQC", message: "FastQC complete. Per-base quality: PASS, Adapter content: WARN" },
  { id: 9, runId: "run_20240315_120000", timestamp: "2024-03-15T12:06:46Z", level: "info", source: "step:TRIMMOMATIC", message: "Trimming adapters and low-quality bases..." },
  { id: 10, runId: "run_20240315_120000", timestamp: "2024-03-15T12:09:20Z", level: "info", source: "step:TRIMMOMATIC", message: "Trimmomatic complete: 1,850,000/2,000,000 reads surviving (92.5%)" },
  { id: 11, runId: "run_20240315_120000", timestamp: "2024-03-15T12:09:21Z", level: "info", source: "step:FASTQC_TRIMMED", message: "Running FastQC on trimmed reads..." },
  { id: 12, runId: "run_20240315_120000", timestamp: "2024-03-15T12:10:15Z", level: "info", source: "step:FASTQC_TRIMMED", message: "FastQC (trimmed) complete. Quality improved across all metrics." },
  { id: 13, runId: "run_20240315_120000", timestamp: "2024-03-15T12:10:16Z", level: "info", source: "step:TRINITY", message: "Starting de novo assembly with Trinity (max_memory: 16G, CPU: 4)..." },
  { id: 14, runId: "run_20240315_120000", timestamp: "2024-03-15T12:15:00Z", level: "info", source: "step:TRINITY", message: "Inchworm: 45,231 kmers assembled" },
  { id: 15, runId: "run_20240315_120000", timestamp: "2024-03-15T12:20:00Z", level: "info", source: "step:TRINITY", message: "Chrysalis: clustering 12,890 components" },
  { id: 16, runId: "run_20240315_120000", timestamp: "2024-03-15T12:30:00Z", level: "info", source: "step:TRINITY", message: "Butterfly: resolving transcript isoforms..." },
  { id: 17, runId: "run_20240315_120000", timestamp: "2024-03-15T12:34:50Z", level: "warn", source: "step:TRINITY", message: "Low complexity filter removed 23 sequences" },
  { id: 18, runId: "run_20240315_120000", timestamp: "2024-03-15T12:35:00Z", level: "info", source: "step:TRINITY", message: "Trinity complete: 12,345 contigs, N50=890, total=8.5 Mbp" },
  { id: 19, runId: "run_20240315_120000", timestamp: "2024-03-15T12:35:01Z", level: "info", source: "step:TRANSDECODER_LONGORFS", message: "Scanning 6 reading frames for ORFs >= 100 aa..." },
  { id: 20, runId: "run_20240315_120000", timestamp: "2024-03-15T12:36:30Z", level: "info", source: "step:TRANSDECODER_LONGORFS", message: "Found 5,200 candidate ORFs" },
  { id: 21, runId: "run_20240315_120000", timestamp: "2024-03-15T12:36:31Z", level: "info", source: "step:TRANSDECODER_PREDICT", message: "Training Markov model on longest ORFs..." },
  { id: 22, runId: "run_20240315_120000", timestamp: "2024-03-15T12:37:45Z", level: "info", source: "step:TRANSDECODER_PREDICT", message: "Predicted 342 protein-coding ORFs (capped from 1,890)" },
  { id: 23, runId: "run_20240315_120000", timestamp: "2024-03-15T12:37:46Z", level: "info", source: "step:CDD_SEARCH", message: "Running RPS-BLAST against CDD (342 proteins, E-value < 0.01)..." },
  { id: 24, runId: "run_20240315_120000", timestamp: "2024-03-15T12:37:46Z", level: "info", source: "step:PROSTT5_PREDICT", message: "Loading ProstT5 model (GPU: NVIDIA T4)..." },
  { id: 25, runId: "run_20240315_120000", timestamp: "2024-03-15T12:38:30Z", level: "info", source: "step:PROSTT5_PREDICT", message: "Predicting 3Di tokens: batch 1/43..." },
  { id: 26, runId: "run_20240315_120000", timestamp: "2024-03-15T12:40:00Z", level: "warn", source: "step:PROSTT5_PREDICT", message: "Skipped 2 sequences exceeding max length (2000 aa)" },
  { id: 27, runId: "run_20240315_120000", timestamp: "2024-03-15T12:40:30Z", level: "info", source: "step:PROSTT5_PREDICT", message: "ProstT5 complete: 340/342 proteins predicted" },
  { id: 28, runId: "run_20240315_120000", timestamp: "2024-03-15T12:40:31Z", level: "info", source: "step:FOLDSEEK_SEARCH", message: "Searching PDB with FoldSeek (340 3Di sequences)..." },
  { id: 29, runId: "run_20240315_120000", timestamp: "2024-03-15T12:42:00Z", level: "info", source: "step:CDD_SEARCH", message: "CDD search complete: 312 domains in 198 proteins" },
  { id: 30, runId: "run_20240315_120000", timestamp: "2024-03-15T12:43:15Z", level: "info", source: "step:FOLDSEEK_SEARCH", message: "FoldSeek complete: 1,280 structural homologs in 256 proteins" },
  { id: 31, runId: "run_20240315_120000", timestamp: "2024-03-15T12:43:16Z", level: "info", source: "step:MERGE_RESULTS", message: "Merging annotations from 3 sources..." },
  { id: 32, runId: "run_20240315_120000", timestamp: "2024-03-15T12:43:45Z", level: "info", source: "step:MERGE_RESULTS", message: "Merged 342 proteins -> annotations.json (1.2 MB)" },
  { id: 33, runId: "run_20240315_120000", timestamp: "2024-03-15T12:43:46Z", level: "info", source: "nextflow", message: "Pipeline completed successfully!" },
  { id: 34, runId: "run_20240315_120000", timestamp: "2024-03-15T12:43:46Z", level: "info", source: "nextflow", message: "Duration: 43m 46s | CPU hours: 2.1 | Succeeded: 11" },
];

export function getMockRunWithSteps(): PipelineRun & { steps: PipelineStep[] } {
  return {
    ...mockRun,
    steps: mockSteps,
    stepCounts: {
      total: mockSteps.length,
      completed: mockSteps.filter((s) => s.status === "completed").length,
      running: mockSteps.filter((s) => s.status === "running").length,
      pending: mockSteps.filter((s) => s.status === "pending").length,
      failed: mockSteps.filter((s) => s.status === "failed").length,
      skipped: mockSteps.filter((s) => s.status === "skipped").length,
    },
  };
}
