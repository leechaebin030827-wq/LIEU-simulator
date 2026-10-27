"""Passenger-facing TV copy for each scene event ('tv' key in the scene payload; the editor's title/desc stay as director notes).

Each entry: (tag, headline, sub[, cta]) in scene order. Run `python3 tools/tv_copy.py` to patch examples/ and public/examples/ in place;
build_scenarios.py also calls apply() so regenerated files keep the copy.
"""
import json
import sys
from pathlib import Path

CALM = ('주행 중', '편안하게 가고 있어요', '필요하면 언제든 불러 주세요')
# Rider interactions are shown big in the middle of the screen: (big text, small line under it).
HEY = ('Hey LIEU', '라고 불러 보세요')

COPY = {
    '01_boarding': [
        ('탑승 환영', '안녕하세요, 루예요!', '오늘 함께 가요. 편하게 앉아 주세요'),
        ('인사', '만나서 반가워요', '목례로 인사드려요'),
        ('탑승 확인', '다 앉으셨나요?', '천천히 둘러보며 확인할게요'),
        ('확인 완료', '모두 준비됐어요', '편히 앉아 계세요'),
        ('출발 준비', '준비되셨으면 출발을 눌러 주세요', '화면의 버튼을 살짝 눌러 주세요'),
        ('출발', '출발합니다!', '안전하게 모실게요'),
        ('출발', '자, 떠나볼까요?', '즐거운 여정 되세요'),
        CALM,
    ],
    '02_driving_a': [
        ('주행 중', '편안하게 가고 있어요', '루가 앞길을 함께 지켜보고 있어요'),
        ('주의', '앞에 공사 구간이 있어요', '루가 주변을 살피는 중이에요'),
        ('확인 완료', '확인했어요', '더 안전한 길을 찾았어요'),
        ('길 안내', '돌아서 갈게요', '바닥에 비친 경로를 봐 주세요'),
        ('우회 안내', '이 길로 우회해요', '조금 더 걸리지만 안전한 길이에요'),
        ('주행 중', '안내를 마쳤어요', '남은 길도 편안하게 모실게요'),
    ],
    '03_arrival': [
        ('주행 중', '편안하게 가고 있어요', '목적지까지 함께할게요'),
        ('곧 도착', '목적지에 거의 다 왔어요', '내릴 준비를 해 주세요'),
        ('소지품 확인', '놓고 내리는 건 없나요?', '루가 함께 살펴볼게요'),
        ('도착', '안녕히 가세요!', '함께해서 즐거웠어요'),
        ('하차 안내', '문은 이쪽이에요', '조심히 내리세요'),
        ('대기', '다음 손님을 기다려요', '오늘도 수고 많으셨어요'),
    ],
    '04_driving_b': [
        CALM + (HEY,),
        ('호출 인식', '네, 불렀어요?', '이름을 부르면 루가 반응해요'),
        ('반가워요', '반가워서 들썩들썩!', '신나는 마음을 몸으로 표현해요'),
        ('좋아요', '좋아요, 좋아요~', '하트 눈으로 살랑살랑 다가가요'),
        ('찡긋', '찡긋!', '눈을 한 번 깜빡여 인사해요'),
        ('부끄러워요', '앗, 부끄러워요', '슬쩍 다시 쳐다봐요'),
        ('신나요', '너무 신나요!', '별 눈으로 반짝반짝 통통 튀어요'),
        ('또 만나요', '언제든 불러 주세요', '루는 늘 여기 있을게요'),
        CALM + (HEY,),
    ],
    '07_bonus_aegyo': [
        ('어라?', '누가 불렀나?', '졸린 눈으로 두리번두리번'),
        ('짠!', '루 등장! 불렀어요?', '반가워서 한걸음에 달려왔어요'),
        ('깔깔', '너무 반가워서 들썩들썩!', '신나는 마음이 몸으로 나와요'),
        ('좋아요', '하트 눈으로 두근두근', '가까이 가서 쳐다볼래요'),
        ('찡긋', '윙크 윙크 윙크!', '눈을 세 번 찡긋했어요'),
        ('부끄러워요', '앗, 부끄러워요', '숨었다가 슬쩍 쳐다봐요'),
        ('신나요', '너무너무 신나요!', '별이 반짝반짝 통통 튀어요'),
        ('빙그르르', '빙그르르르~', '신나서 한 바퀴 돌아요'),
        ('윙크', '윙크 윙크 윙크 윙크!', '핑크빛으로 반짝반짝'),
        ('빙그르르', '이번엔 반대로 빙그르르!', '신나서 한 바퀴 더 돌아요'),
        ('고마워요', '하트 날려요, 안녕!', '또 불러 주세요'),
        ('대기', '이제 얌전히 있을게요', '필요하면 언제든 불러 주세요'),
    ],
}


def apply(seq: dict) -> bool:
    """Attach 'tv' to the scene events of a sequence dict (matched by order). Returns False if no copy exists or counts differ."""
    copy = COPY.get(seq.get('id'))
    scenes = sorted((e for e in seq['tracks']['events'] if e['type'] == 'scene'), key=lambda e: e['tSec'])
    if not copy or len(copy) != len(scenes):
        return False
    for e, (tag, head, sub, *cta) in zip(scenes, copy):
        tv = {'tag': tag, 'head': head, 'sub': sub}
        if cta:
            tv['cta'] = {'text': cta[0][0], 'sub': cta[0][1]}
        e['payload']['tv'] = tv
    return True


if __name__ == '__main__':
    root = Path(__file__).resolve().parent.parent
    for d in ('examples', 'public/examples'):
        for f in sorted((root / d).glob('0?_*.lieu.json')):
            seq = json.loads(f.read_text(encoding='utf8'))
            ok = apply(seq)
            if ok:
                f.write_text(json.dumps(seq, ensure_ascii=False, indent=2), encoding='utf8')
            print(('patched ' if ok else 'SKIPPED (scene count differs) ') + str(f.relative_to(root)), file=sys.stdout)
