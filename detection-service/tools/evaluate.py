#!/usr/bin/env python3
"""Compare the violations the system detected with a hand-labelled list, and print
precision and recall.

    python tools/evaluate.py detected.json labels.json [--min-iou 0.3] [--json]

detected.json  - what the system found. Download it from the dashboard backend:
                 GET /api/violations/export?video=<videoId>   (a list of objects)
labels.json    - what a person saw when watching the same video, e.g.
                 [{"zone": "Gate", "start_s": 12, "end_s": 95, "plate": "TN09AB1234"}]
                 Times are seconds into the video. `plate` and `kind` are optional.

A detection counts as correct (a true positive) when it is in the same zone (and the
same kind, if the label gives one) and its time span overlaps the label's span by at
least --min-iou (intersection over union of the two time spans). Each label can be
matched by only one detection.

  precision = correct detections / all detections      (how many alarms were real)
  recall    = correct detections / all labels          (how many real ones were caught)
"""
import argparse
import json
import sys


def interval_iou(a_start, a_end, b_start, b_end):
    inter = max(0.0, min(a_end, b_end) - max(a_start, b_start))
    union = (a_end - a_start) + (b_end - b_start) - inter
    return inter / union if union > 0 else 0.0


def normalise_plate(p):
    return "".join(ch for ch in (p or "").upper() if ch.isalnum()) or None


def match(detected, labels, min_iou=0.3):
    """Greedy one-to-one matching, best overlap first. Returns (pairs, extra, missed)."""
    candidates = []
    for di, d in enumerate(detected):
        for li, lab in enumerate(labels):
            if str(d.get("zone", "")).strip().lower() != str(lab.get("zone", "")).strip().lower():
                continue
            if lab.get("kind") and d.get("kind") and lab["kind"] != d["kind"]:
                continue
            score = interval_iou(float(d["start_s"]), float(d["end_s"]),
                                 float(lab["start_s"]), float(lab["end_s"]))
            if score >= min_iou:
                candidates.append((score, di, li))
    candidates.sort(reverse=True)
    used_d, used_l, pairs = set(), set(), []
    for score, di, li in candidates:
        if di in used_d or li in used_l:
            continue
        used_d.add(di); used_l.add(li); pairs.append((di, li, score))
    extra = [di for di in range(len(detected)) if di not in used_d]      # false positives
    missed = [li for li in range(len(labels)) if li not in used_l]       # false negatives
    return pairs, extra, missed


def evaluate(detected, labels, min_iou=0.3):
    pairs, extra, missed = match(detected, labels, min_iou)
    tp, fp, fn = len(pairs), len(extra), len(missed)
    precision = tp / (tp + fp) if (tp + fp) else None
    recall = tp / (tp + fn) if (tp + fn) else None
    f1 = (2 * precision * recall / (precision + recall)) if precision and recall else (0.0 if tp == 0 and (fp or fn) else None)

    # Plate quality, over matched pairs whose label has a plate
    with_plate = [(detected[di], labels[li]) for di, li, _ in pairs if normalise_plate(labels[li].get("plate"))]
    read = [(d, lab) for d, lab in with_plate if normalise_plate(d.get("plate"))]
    exact = [1 for d, lab in read if normalise_plate(d["plate"]) == normalise_plate(lab["plate"])]
    return {
        "detections": len(detected), "labels": len(labels),
        "true_positives": tp, "false_positives": fp, "false_negatives": fn,
        "precision": precision, "recall": recall, "f1": f1,
        "plates_labelled": len(with_plate),
        "plates_read": len(read),
        "plates_exactly_right": len(exact),
        "plate_read_rate": (len(read) / len(with_plate)) if with_plate else None,
        "plate_accuracy_when_read": (len(exact) / len(read)) if read else None,
        "false_positive_items": [detected[i] for i in extra],
        "missed_items": [labels[i] for i in missed],
    }


def pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def report(r):
    lines = [
        f"Detections: {r['detections']}    Hand labels: {r['labels']}",
        f"Correct (TP): {r['true_positives']}    Wrong alarms (FP): {r['false_positives']}    Missed (FN): {r['false_negatives']}",
        f"Precision: {pct(r['precision'])}   (of the alarms raised, how many were real)",
        f"Recall:    {pct(r['recall'])}   (of the real violations, how many were caught)",
        f"F1 score:  {pct(r['f1'])}",
        "",
        f"Plates (matched violations whose label has a plate): {r['plates_labelled']}",
        f"  read at all:        {r['plates_read']}  ({pct(r['plate_read_rate'])})",
        f"  exactly right:      {r['plates_exactly_right']}  ({pct(r['plate_accuracy_when_read'])} of those read)",
    ]
    if r["false_positive_items"]:
        lines += ["", "Wrong alarms:"] + [f"  {i.get('zone')}  {i.get('start_s')}-{i.get('end_s')}s  {i.get('plate') or '-'}" for i in r["false_positive_items"]]
    if r["missed_items"]:
        lines += ["", "Missed:"] + [f"  {i.get('zone')}  {i.get('start_s')}-{i.get('end_s')}s  {i.get('plate') or '-'}" for i in r["missed_items"]]
    return "\n".join(lines)


def main(argv=None):
    ap = argparse.ArgumentParser(description="Precision and recall of detected violations against hand labels.")
    ap.add_argument("detected"); ap.add_argument("labels")
    ap.add_argument("--min-iou", type=float, default=0.3, help="minimum time-span overlap to count as a match (default 0.3)")
    ap.add_argument("--json", action="store_true", help="print the result as JSON")
    a = ap.parse_args(argv)
    with open(a.detected, encoding="utf-8") as f: detected = json.load(f)
    with open(a.labels, encoding="utf-8") as f: labels = json.load(f)
    if isinstance(detected, dict): detected = detected.get("violations", [])
    r = evaluate(detected, labels, a.min_iou)
    print(json.dumps(r, indent=2) if a.json else report(r))
    return 0


if __name__ == "__main__":
    sys.exit(main())
