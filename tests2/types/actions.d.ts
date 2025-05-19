/*******************************/
/* BASE INTERFACES FOR ACTIONS */
/*******************************/
import { APIRequestContext } from 'playwright-core'

export interface ActionWaitUntil {
    // The event to wait for
    event: ActionType
    // The timeout in milliseconds to execute the action if the event is not triggered
    timeout?: number
}
export interface ActionData<Payload extends object> {
    // The data of the action to execute
    payload?: Payload

    // The event to wait for before executing the action
    waitUntil?: ActionWaitUntil

    // Custom event to trigger after the action
    customSharedEvent?: string
}
export interface BaseActionDefinition<Type extends string, Payload extends object> {
    type: Type
    data: ActionData<Payload>
}
export interface Action <
    Type extends string,
    Payload = undefined,
    Response extends object
> {
    definition: BaseActionDefinition<Type, Payload>
    response: Response
}

/*******************************/
/* SPECIFIC ACTIONS INTERFACES */
/*******************************/

/* Register */
interface RegisterActionPayload {
    sip_domain: string
    username: string
    password: string
}
interface RegisterActionResponse {
    success: boolean
    instanceId: string
}
export type RegisterAction = Action<
    'register',
    RegisterActionPayload,
    RegisterActionResponse
>

/* Dial */
interface DialActionData {
    target: string
}
interface DialActionResponse {
    success: boolean
    target: string,
    callId: string
}
export type DialAction = Action<
    'dial',
    DialActionData,
    DialActionResponse
>

/* Wait */
interface WaitActionData {
    // The time to wait in milliseconds
    time: number
}
interface WaitActionResponse {
    success: boolean
}
export type WaitAction = Action<
    'wait',
    WaitActionData,
    WaitActionResponse
>

/* Play Sound */
interface PlaySoundActionData {
    // The sound to play, can be a URL or a file path
    sound: string
}
interface PlaySoundActionResponse {
    success: boolean
}
export type PlaySoundAction = Action<
    'playSound',
    PlaySoundActionData,
    PlaySoundActionResponse
>

/* Answer */
interface AnswerActionResponse {
    success: boolean
    callId: string
}
export type AnswerAction = Action<
    'answer',
    never,
    AnswerActionResponse
>

/* Hold */
interface HoldActionResponse {
    success: boolean
    callId: string
}
export type HoldAction = Action<
    'hold',
    never,
    HoldActionResponse
>

/* Unhold */
interface UnholdActionResponse {
    success: boolean
    callId: string
}
export type UnholdAction = Action<
    'unhold',
    never,
    UnholdActionResponse
>

/* Hangup */
interface HangupActionResponse {
    success: boolean
    callId: string
}
export type HangupAction = Action<
    'hangup',
    never,
    HangupActionResponse
>

/* Send DTMF */
interface SendDTMFEventData {
    // The DTMF number to send
    dtmf: string
}
interface SendDTMFActionResponse {
    dtmf: string
    callId: string
    success: boolean
}
export type SendDTMFAction = Action<
    'sendDTMF',
    SendDTMFEventData,
    SendDTMFActionResponse
>

/* Transfer */
interface TransferEventData {
    // The target to transfer the call to
    target: string
}
interface TransferActionResponse {
    callId: string
    success: boolean
}
export type TransferAction = Action<
    'transfer',
    TransferEventData,
    TransferActionResponse
>

/* Unregister */
interface UnregisterActionResponse {
    success: boolean
}
export type UnregisterAction = Action<
    'unregister',
    never,
    UnregisterActionResponse
>

/* Request */
interface RequestActionData {
    url: string
    options: Parameters<APIRequestContext['fetch']>[1]
}
export type RequestAction = Action<
    'request',
    RequestActionData,
    any
>

/****************/
/* Helper types */
/****************/
export type GetActionDefinition<T extends Action> = T['definition']
export type GetActionResponse<T extends Action> = T['response']
export type GetActionData<T extends Action> = GetActionDefinition<T>['data']
export type GetActionPayload<T extends Action> = GetActionData<T>['payload']
type ActionExecutorAction<T extends Action> = (data: GetActionPayload<T>) => Promise<GetActionResponse<T>>

export interface ActionsMap {
    register: RegisterAction
    dial: DialAction
    wait: WaitAction
    playSound: PlaySoundAction
    answer: AnswerAction
    hold: HoldAction
    unhold: UnholdAction
    hangup: HangupAction
    sendDTMF: SendDTMFAction
    transfer: TransferAction
    unregister: UnregisterAction
    request: RequestAction
}

export type ActionsExecutorImplements = {
    [K in keyof ActionsMap]: ActionExecutorAction<ActionsMap[K]>
}
export type ActionsScenariosBuilderImplements = {
    [K in keyof ActionsMap]: (data: GetActionData<ActionsMap[K]>) => GetActionDefinition<ActionsMap[K]>
}
export type ActionsResponseMap = {
    [K in keyof ActionsMap]: GetActionResponse<ActionsMap[K]>
}

export type ActionType = keyof ActionsMap
export type ActionByActionType<T extends ActionType> = T extends keyof ActionsMap ? ActionsMap[T] : never
