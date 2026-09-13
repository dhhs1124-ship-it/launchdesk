/* window.launchdeskStore — 비회원/회원 저장 방식을 완전히 분리하는 단일
   저장소 레이어. app.js/tools.js는 이 파일을 통해서만 STEP 진행상황/
   체크리스트/워크시트/도구 기록을 읽고 쓴다. 두 파일은 서로의 존재를
   몰라도 되고, onChange()로만 느슨하게 연결된다.

   비회원: 모든 데이터는 아래 state(메모리)에만 존재한다. 어디에도
   localStorage/sessionStorage로 옮겨쓰지 않으므로, 새로고침하거나 브라우저를
   다시 열면 사라진다 — 의도된 동작이다.

   회원: 로그인/세션 복원 시 hydrate(userId)가 Supabase의
   user_step_progress + tool_records를 읽어 이 메모리를 채운다. 이후 모든
   쓰기(setStepState/addCalcRecord/...)는 메모리를 먼저(그리고 항상) 갱신해
   화면이 네트워크를 기다리지 않게 하고, 로그인 상태일 때만 백그라운드로
   Supabase에도 반영한다(실패해도 화면은 계속 동작 — 콘솔에만 경고).
   로그아웃(resetToGuest)은 이 메모리만 비우고, Supabase의 데이터는
   절대 건드리지 않는다.

   스키마 주의(실행 전 꼭 확인하세요):
   - user_step_progress: (user_id, step_path)에 UNIQUE 제약이 있어야
     upsert가 "그 STEP의 최신 상태로 덮어쓰기"로 정확히 동작합니다.
   - tool_records: created_at 컬럼이 있어야 "최근 5개" 정렬이 정상 동작
     합니다(없으면 콘솔에 경고만 남기고 빈 목록으로 표시됩니다). */
(function(){
  var state = {
    authed: false,
    userId: null,
    steps: {},        // { [step_path]: { data: array|object|null, isCompleted: boolean } }
    calcHistory: [],  // 최근 것이 배열 앞쪽 — 화면엔 최대 5개까지만
    adlogRecords: []  // 최근 것이 배열 앞쪽
  };
  var listeners = [];

  function notifyChange(){
    listeners.forEach(function(fn){
      try{ fn(); }catch(e){ console.error('[launchdesk] store onChange 리스너 오류:', e); }
    });
  }
  function client(){ return window.launchdeskSupabase || null; }

  // ------------------------------------------------------------------ reads
  function getStepData(path){
    var e = state.steps[path];
    return e ? e.data : null;
  }
  function isStepCompleted(path){
    var e = state.steps[path];
    return !!(e && e.isCompleted);
  }
  function getCompletedPaths(){
    return Object.keys(state.steps).filter(function(p){ return state.steps[p].isCompleted; });
  }
  function getCalcHistory(){ return state.calcHistory.slice(); }
  function getAdlogRecords(){ return state.adlogRecords.slice(); }
  // 로그인 직전 "게스트 메모리" 상태를 통째로 떠간다(얕은 복사) — hydrate()가
  // 이 state를 서버 값으로 덮어쓰기 전에, app.js가 로그인 시 병합 여부를
  // 물어보는 데 쓴다. 여기서 리턴한 객체는 이후 이 store의 state와 완전히
  // 분리된 별도 사본이라, hydrate()/resetToGuest()가 뒤이어 실행돼도
  // 영향받지 않는다.
  function getSnapshot(){
    var stepsCopy = {};
    Object.keys(state.steps).forEach(function(p){
      stepsCopy[p] = { data: state.steps[p].data, isCompleted: state.steps[p].isCompleted };
    });
    return {
      steps: stepsCopy,
      calcHistory: state.calcHistory.slice(),
      adlogRecords: state.adlogRecords.slice()
    };
  }
  // ---- 평가 전용 임시 기록(DB 쓰기 없음) ----------------------------------
  // 로그인 시 게스트 데이터를 계정과 병합할 때, "이 데이터라면 기존
  // STEP_EVALUATORS가 완료로 볼지"를 실제로 그 평가 함수로 확인해봐야
  // 한다. 메모리만 임시로 바꿔서 그 평가가 가능하게 할 뿐, Supabase에는
  // 아무 것도 쓰지 않고 onChange도 울리지 않는다 — 실제 저장은 호출한
  // 쪽이 평가 결과를 가지고 별도로 setStepState()/직접 upsert해야 한다.
  function pokeStepData(path, data){
    var prevCompleted = state.steps[path] ? state.steps[path].isCompleted : false;
    state.steps[path] = { data: data, isCompleted: prevCompleted };
  }

  // ----------------------------------------------------------------- writes
  /* STEP 저장(user_step_progress)만 STEP(경로) 단위로 debounce한다 — 워크시트
     타이핑처럼 짧은 시간에 여러 번 바뀌는 값을 매번 upsert하면, 네트워크
     응답 순서가 뒤바뀌었을 때 오래된 값이 마지막에 저장되는 race condition이
     생길 수 있다("L"→"La"→"Lau" 각각 요청을 보냈는데 "La" 응답이 가장
     늦게 와서 DB에 "La"만 남는 경우). 메모리(state.steps)는 항상 즉시
     갱신되고 화면도 그 메모리를 그대로 보여주므로 사용자 체감은 바뀌지
     않는다 — 늦춰지는 건 Supabase에 실제로 쓰는 시점뿐이다. */
  var STEP_SAVE_DEBOUNCE_MS = 600;
  var FLUSH_MAX_WAIT_MS = 3000; // 로그아웃 직전 flush가 네트워크 문제로 무한정 막히지 않도록 하는 상한
  var pendingStepTimers = {};   // { [step_path]: setTimeout id } — debounce 대기 중
  var stepWriteInFlight = {};   // { [step_path]: true } — 지금 Supabase에 실제로 쓰고 있는 중
  var stepWriteDirty = {};      // { [step_path]: true } — 쓰는 도중 또 바뀌어서, 끝나면 한 번 더 써야 함

  function clearPendingStepTimers(){
    Object.keys(pendingStepTimers).forEach(function(p){ clearTimeout(pendingStepTimers[p]); });
    pendingStepTimers = {};
    // 이미 네트워크로 나간 요청(inFlight) 자체는 취소할 수 없지만, 그
    // 완료 후 "한 번 더 써야 한다"는 예약(dirty)은 사용자 전환 시점에
    // 의미가 없어지므로 정리한다 — 완료 콜백의 userId 재확인과 함께
    // A→B 전환 시 A의 재저장이 B로 넘어가지 않도록 하는 이중 방어.
    stepWriteDirty = {};
  }
  // STEP별 실제 Supabase 쓰기 — 동시에 2개 이상 나가지 않도록 이 함수를
  // 통해서만 네트워크 요청을 보낸다(requestStepSave가 그 문지기 역할).
  // forUserId는 "이 요청을 시작한 시점의" 사용자 — 완료 후 재저장 여부를
  // 판단할 때, 그 사이 사용자가 바뀌지 않았는지 다시 확인하는 기준이 된다.
  function runStepUpsert(path, forUserId){
    stepWriteInFlight[path] = true;
    var entry = state.steps[path];
    var sb = client();
    if(!entry || !sb){
      stepWriteInFlight[path] = false;
      return;
    }
    function afterAttempt(){
      stepWriteInFlight[path] = false;
      // 이 요청이 나가 있는 동안 값이 또 바뀌었다면(dirty), 그리고 지금도
      // 여전히 그 사용자 세션이 맞다면(로그아웃/계정전환 없었다면) 최신
      // 상태로 한 번 더 저장한다. 중간 상태는 저장하지 않고 "완료 → 필요하면
      // 최신값으로 요청 한 번 더"만 반복한다.
      var shouldResave = stepWriteDirty[path] && state.authed && state.userId === forUserId;
      stepWriteDirty[path] = false;
      if(shouldResave) runStepUpsert(path, forUserId);
    }
    sb.from('user_step_progress').upsert({
      user_id: forUserId,
      step_path: path,
      data: entry.data,
      is_completed: !!entry.isCompleted,
      completed_at: entry.isCompleted ? new Date().toISOString() : null
    }, { onConflict: 'user_id,step_path' }).then(function(res){
      if(res.error) console.warn('[launchdesk] STEP 저장 실패(' + path + '):', res.error.message);
      afterAttempt();
    }).catch(function(err){
      console.warn('[launchdesk] STEP 저장 중 오류(' + path + '):', err && err.message);
      afterAttempt();
    });
  }
  // "지금 이 STEP을 저장해줘" 요청의 단일 진입점(debounce 만료/blur/로그아웃
  // 직전 flush 전부 이 함수를 거친다). 이미 그 STEP에 대한 요청이 나가 있는
  // 중이면 병렬로 새 요청을 보내지 않고 dirty만 표시해, 진행 중인 요청이
  // 끝난 뒤 runStepUpsert의 afterAttempt가 최신 상태로 한 번 더 쓰게 한다.
  function requestStepSave(path){
    if(!state.authed || !state.userId) return;
    if(stepWriteInFlight[path]){
      stepWriteDirty[path] = true;
      return;
    }
    runStepUpsert(path, state.userId);
  }
  // 타이머가 실제로 울렸을 때 실행 — forUserId는 예약 당시의 사용자다.
  // 그 사이 로그아웃했거나 다른 계정으로 바뀌었으면(현재 state.userId가
  // 달라졌거나 인증이 풀렸으면) 쓰지 않는다 — A의 예약 저장이 B 세션에서
  // 실행되는 사고를 막는 마지막 방어선(주된 방어는 resetToGuest/hydrate가
  // 타이머 자체를 즉시 정리하는 것).
  function flushPendingStep(path, forUserId){
    delete pendingStepTimers[path];
    if(!state.authed || state.userId !== forUserId) return;
    requestStepSave(path);
  }
  function setStepState(path, data, isCompleted){
    state.steps[path] = { data: data, isCompleted: !!isCompleted };
    if(!state.authed || !state.userId) return;
    var userId = state.userId;
    if(pendingStepTimers[path]) clearTimeout(pendingStepTimers[path]);
    pendingStepTimers[path] = setTimeout(function(){ flushPendingStep(path, userId); }, STEP_SAVE_DEBOUNCE_MS);
  }
  // 워크시트 입력칸에서 포커스가 빠지는 등, "지금 바로 저장해도 되는"
  // 시점에 예약된 저장을 앞당겨 실행한다. 예약이 없으면 아무 일도
  // 하지 않는다(비회원이거나, 이미 저장이 끝난 경우 포함). 이미 그 STEP의
  // 요청이 나가 있는 중이면(requestStepSave 내부에서) 병렬로 보내지 않고
  // dirty로만 표시된다.
  function flushStepNow(path){
    if(pendingStepTimers[path]){
      clearTimeout(pendingStepTimers[path]);
      delete pendingStepTimers[path];
    }
    requestStepSave(path);
  }
  // 로그아웃 버튼 등, "지금 로그아웃하기 전에 밀린 저장을 다 반영해줘"
  // 용도 — 모든 STEP의 예약된 저장을 즉시 시도로 전환하고, 그 요청들(+
  // 완료 후 필요한 재저장까지)이 전부 끝날 때까지 기다리는 Promise를
  // 반환한다. 네트워크가 응답하지 않아도 FLUSH_MAX_WAIT_MS 후에는 그냥
  // 진행하도록(resolve) 해서, 로그아웃 자체가 영원히 막히지 않게 한다.
  function flushAllPendingSteps(){
    Object.keys(pendingStepTimers).forEach(function(path){
      clearTimeout(pendingStepTimers[path]);
      delete pendingStepTimers[path];
      requestStepSave(path);
    });
    var deadline = Date.now() + FLUSH_MAX_WAIT_MS;
    return new Promise(function(resolve){
      (function poll(){
        var stillBusy = Object.keys(stepWriteInFlight).some(function(p){ return stepWriteInFlight[p]; })
          || Object.keys(stepWriteDirty).some(function(p){ return stepWriteDirty[p]; });
        if(!stillBusy || Date.now() > deadline){ resolve(); return; }
        setTimeout(poll, 50);
      })();
    });
  }
  function addCalcRecord(record){
    state.calcHistory.unshift(record);
    state.calcHistory = state.calcHistory.slice(0, 5);
    if(!state.authed || !state.userId) return;
    var sb = client();
    if(!sb) return;
    sb.from('tool_records').insert({
      user_id: state.userId,
      tool_type: 'margin_calc',
      data: record
    }).then(function(res){
      if(res.error) console.warn('[launchdesk] 마진계산 기록 저장 실패:', res.error.message);
    });
  }
  function clearCalcHistory(){
    state.calcHistory = [];
    if(!state.authed || !state.userId) return;
    var sb = client();
    if(!sb) return;
    sb.from('tool_records').delete()
      .eq('user_id', state.userId).eq('tool_type', 'margin_calc')
      .then(function(res){ if(res.error) console.warn('[launchdesk] 마진계산 기록 삭제 실패:', res.error.message); });
  }
  function addAdlogRecord(record){
    state.adlogRecords.unshift(record);
    if(!state.authed || !state.userId) return;
    var sb = client();
    if(!sb) return;
    sb.from('tool_records').insert({
      user_id: state.userId,
      tool_type: 'ad_log',
      data: record
    }).then(function(res){
      if(res.error) console.warn('[launchdesk] 광고기록 저장 실패:', res.error.message);
    });
  }
  function removeAdlogRecord(id){
    state.adlogRecords = state.adlogRecords.filter(function(r){ return String(r.id) !== String(id); });
    if(!state.authed || !state.userId) return;
    var sb = client();
    if(!sb) return;
    // ad_log 레코드의 식별자는 DB 기본 PK가 아니라, 생성 시 data 안에
    // 함께 저장해 둔 클라이언트 id(Date.now())다 — JSON 컬럼 안 값으로
    // 필터링한다(PostgREST의 `column->>key` 표기).
    sb.from('tool_records').delete()
      .eq('user_id', state.userId).eq('tool_type', 'ad_log')
      .eq('data->>id', String(id))
      .then(function(res){ if(res.error) console.warn('[launchdesk] 광고기록 삭제 실패:', res.error.message); });
  }

  // -------------------------------------------------------------- lifecycle
  function resetState(){
    state.steps = {};
    state.calcHistory = [];
    state.adlogRecords = [];
  }
  function hydrate(userId){
    var sb = client();
    if(!sb) return Promise.resolve();
    // 이전 사용자(또는 게스트)에게 예약돼 있던 STEP 저장 타이머를 새 계정
    // 세션으로 넘기지 않는다 — A 로그아웃 직후 곧바로 B가 로그인하는
    // 경우처럼, A 몫으로 예약된 저장이 B의 user_id로 실행되는 것을 막는다.
    clearPendingStepTimers();
    state.userId = userId;

    var stepsQ = sb.from('user_step_progress').select('step_path, data, is_completed').eq('user_id', userId);
    var calcQ = sb.from('tool_records').select('data, created_at').eq('user_id', userId).eq('tool_type', 'margin_calc').order('created_at', { ascending: false }).limit(5);
    var adlogQ = sb.from('tool_records').select('data, created_at').eq('user_id', userId).eq('tool_type', 'ad_log').order('created_at', { ascending: false });

    return Promise.all([stepsQ, calcQ, adlogQ]).then(function(results){
      var stepsRes = results[0], calcRes = results[1], adlogRes = results[2];
      resetState();

      if(stepsRes && !stepsRes.error && stepsRes.data){
        stepsRes.data.forEach(function(row){
          state.steps[row.step_path] = { data: row.data, isCompleted: !!row.is_completed };
        });
      } else if(stepsRes && stepsRes.error){
        console.warn('[launchdesk] user_step_progress 조회 실패:', stepsRes.error.message);
      }

      if(calcRes && !calcRes.error && calcRes.data){
        state.calcHistory = calcRes.data.map(function(row){ return row.data; });
      } else if(calcRes && calcRes.error){
        console.warn('[launchdesk] 마진계산 기록 조회 실패(정렬 컬럼 확인 필요):', calcRes.error.message);
      }

      if(adlogRes && !adlogRes.error && adlogRes.data){
        state.adlogRecords = adlogRes.data.map(function(row){ return row.data; });
      } else if(adlogRes && adlogRes.error){
        console.warn('[launchdesk] 광고기록 조회 실패(정렬 컬럼 확인 필요):', adlogRes.error.message);
      }

      state.authed = true;
      notifyChange();
    }).catch(function(err){
      console.warn('[launchdesk] 데이터 불러오기 중 오류:', err && err.message);
      state.authed = true; // 일부 조회 실패로 로그인 자체를 무효화하지 않는다
      notifyChange();
    });
  }
  function resetToGuest(){
    clearPendingStepTimers(); // 로그아웃하는 사용자 몫으로 예약된 저장은 실행되지 않게 취소
    state.authed = false;
    state.userId = null;
    resetState();
    notifyChange();
  }
  function onChange(fn){ if(typeof fn === 'function') listeners.push(fn); }

  window.launchdeskStore = {
    isAuthed: function(){ return state.authed; },
    getStepData: getStepData,
    isStepCompleted: isStepCompleted,
    getCompletedPaths: getCompletedPaths,
    setStepState: setStepState,
    flushStepNow: flushStepNow,
    flushAllPendingSteps: flushAllPendingSteps,
    getCalcHistory: getCalcHistory,
    getSnapshot: getSnapshot,
    pokeStepData: pokeStepData,
    addCalcRecord: addCalcRecord,
    clearCalcHistory: clearCalcHistory,
    getAdlogRecords: getAdlogRecords,
    addAdlogRecord: addAdlogRecord,
    removeAdlogRecord: removeAdlogRecord,
    hydrate: hydrate,
    resetToGuest: resetToGuest,
    onChange: onChange
  };
})();
