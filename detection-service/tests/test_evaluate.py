import json

from tools.evaluate import evaluate, interval_iou, main

LABELS = [
    {"zone": "Gate", "start_s": 10, "end_s": 100, "plate": "TN09AB1234"},
    {"zone": "Gate", "start_s": 200, "end_s": 260, "plate": "TN10CD5678"},
    {"zone": "Side", "start_s": 50, "end_s": 120},
]


def det(zone, s, e, plate=None, kind="no_parking"):
    return {"zone": zone, "start_s": s, "end_s": e, "plate": plate, "kind": kind}


def test_interval_overlap_maths():
    assert interval_iou(0, 10, 0, 10) == 1.0
    assert interval_iou(0, 10, 10, 20) == 0.0
    assert interval_iou(0, 10, 5, 15) == 5 / 15


def test_perfect_detection_gives_100_percent():
    r = evaluate([det("Gate", 12, 98, "TN09AB1234"), det("Gate", 205, 255, "TN10CD5678"), det("Side", 55, 118)], LABELS)
    assert (r["true_positives"], r["false_positives"], r["false_negatives"]) == (3, 0, 0)
    assert r["precision"] == 1.0 and r["recall"] == 1.0


def test_a_wrong_alarm_lowers_precision_and_a_miss_lowers_recall():
    detected = [det("Gate", 12, 98), det("Gate", 400, 450)]       # one real, one wrong; two labels unseen
    r = evaluate(detected, LABELS)
    assert (r["true_positives"], r["false_positives"], r["false_negatives"]) == (1, 1, 2)
    assert r["precision"] == 0.5 and abs(r["recall"] - 1 / 3) < 1e-9


def test_right_time_wrong_zone_is_not_a_match():
    r = evaluate([det("Side", 12, 98)], [LABELS[0]])
    assert r["true_positives"] == 0 and r["false_positives"] == 1 and r["false_negatives"] == 1


def test_a_label_can_only_be_matched_once():
    r = evaluate([det("Gate", 10, 100), det("Gate", 12, 98)], [LABELS[0]])
    assert r["true_positives"] == 1 and r["false_positives"] == 1


def test_a_kind_in_the_label_must_agree():
    labels = [{"zone": "Gate", "start_s": 10, "end_s": 100, "kind": "spacing"}]
    assert evaluate([det("Gate", 10, 100, kind="no_parking")], labels)["true_positives"] == 0
    assert evaluate([det("Gate", 10, 100, kind="spacing")], labels)["true_positives"] == 1


def test_plate_scores_count_only_matched_violations_with_a_labelled_plate():
    detected = [det("Gate", 12, 98, "TN09AB1234"),        # right
                det("Gate", 205, 255, "TN10CD5679"),      # read, but one digit wrong
                det("Side", 55, 118, "ZZ99ZZ9999")]       # label has no plate: not counted
    r = evaluate(detected, LABELS)
    assert r["plates_labelled"] == 2 and r["plates_read"] == 2 and r["plates_exactly_right"] == 1
    assert r["plate_accuracy_when_read"] == 0.5


def test_unread_plates_lower_the_read_rate_not_the_accuracy():
    r = evaluate([det("Gate", 12, 98, None), det("Gate", 205, 255, "TN10CD5678")], LABELS)
    assert r["plate_read_rate"] == 0.5 and r["plate_accuracy_when_read"] == 1.0


def test_plate_comparison_ignores_spaces_and_case():
    r = evaluate([det("Gate", 12, 98, "tn 09 ab 1234")], [LABELS[0]])
    assert r["plates_exactly_right"] == 1


def test_empty_inputs_do_not_crash():
    r = evaluate([], [])
    assert r["precision"] is None and r["recall"] is None
    r = evaluate([], LABELS)
    assert r["recall"] == 0.0 and r["precision"] is None


def test_command_line_runs_on_files_and_accepts_the_export_wrapper(tmp_path, capsys):
    d = tmp_path / "d.json"; l = tmp_path / "l.json"
    d.write_text(json.dumps({"violations": [det("Gate", 12, 98, "TN09AB1234")]}))
    l.write_text(json.dumps([LABELS[0]]))
    assert main([str(d), str(l)]) == 0
    out = capsys.readouterr().out
    assert "Precision: 100.0%" in out and "Recall:    100.0%" in out
