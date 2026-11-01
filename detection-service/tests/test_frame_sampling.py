"""Frame counting: which frames get a plate read, with the default frame stride."""
import sys
import types
from types import SimpleNamespace

# The YOLO library isn't needed to test frame counting; stub it so this runs anywhere.
sys.modules.setdefault("ultralytics", types.SimpleNamespace(YOLO=object))

from app.pipeline import DetectionJob
from app.schemas import JobParams


class FakeVotes:
    reads = 0
    locked = False

    def add(self, _):
        self.reads += 1

    def best(self):
        return None

    def give_up(self):
        self.locked = True


class FakeReader:
    def __init__(self):
        self.read_ids = set()

    def can_read(self, _bbox):
        return True

    def read(self, _frame, bbox):
        self.read_ids.add(bbox[0])     # bbox[0] carries the vehicle id in this test
        return None


def run(stride, n_processed=30, ids=range(1, 9)):
    job = object.__new__(DetectionJob)
    job._stop = False
    job.req = SimpleNamespace(params=JobParams(frame_stride=stride))
    states = [SimpleNamespace(track_id=i, bbox=(i, 0, 300, 100), votes=FakeVotes(),
                              session=SimpleNamespace(plate_reads=0, plate_status="reading")) for i in ids]
    manager = SimpleNamespace(plate_candidates=lambda: states, set_plate=lambda *a: None)
    reader = FakeReader()
    frame_no = 0
    for _ in range(n_processed):
        frame_no += stride          # the pipeline only processes every stride-th frame
        job._read_plates(manager, reader, None, frame_no)
    return reader.read_ids


def test_every_vehicle_gets_plate_reads_with_the_default_stride():
    assert run(stride=2) == set(range(1, 9))     # odd AND even track ids


def test_every_vehicle_gets_plate_reads_with_other_strides():
    for stride in (1, 3, 4):
        assert run(stride=stride) == set(range(1, 9)), f"stride {stride}"
