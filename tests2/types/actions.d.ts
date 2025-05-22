/*******************************/
/* BASE INTERFACES FOR ACTIONS */
/*******************************/
import { APIRequestContext } from 'playwright-core'
import { EventType } from './events'

export interface ActionSuccessResponse {
    success: true
    // The response data of the action
    [key: string]: any
}
export interface ActionErrorResponse {
    success: false
    // The error message of the action
    error: string
}

interface ActionResponseToContextEnabled {
    // The action will set the response to the context
    setToContext: true
    // The key to set in the context
    contextKeyToSet: string
}
interface ActionResponseToContextDisabled {
    // The action will not set the response to the context
    setToContext: false
    // The key to set in the context
    contextKeyToSet?: never
}
export type ActionResponseToContext =
    | ActionResponseToContextEnabled
    | ActionResponseToContextDisabled
export interface ActionWaitUntil {
    // The event to wait for
    event: EventType
    // The timeout in milliseconds to execute the action if the event is not triggered
    timeout?: number
}
export interface ActionData<Payload extends object> {
    // The data of the action to execute
    payload?: Payload

    // Configuration of the context modification after the action
    responseToContext?: ActionResponseToContext

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
    SuccessResponse extends ActionSuccessResponse
> {
    definition: BaseActionDefinition<Type, Payload>
    response: SuccessResponse | ActionErrorResponse
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
interface RegisterActionResponse extends ActionSuccessResponse {
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
interface DialActionResponse extends ActionSuccessResponse {
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
interface WaitActionResponse extends ActionSuccessResponse {
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
interface PlaySoundActionResponse extends ActionSuccessResponse {
    success: boolean
}
export type PlaySoundAction = Action<
    'playSound',
    PlaySoundActionData,
    PlaySoundActionResponse
>

/* Answer */
interface AnswerActionResponse extends ActionSuccessResponse {
    success: boolean
    callId: string
}
export type AnswerAction = Action<
    'answer',
    never,
    AnswerActionResponse
>

/* Hold */
interface HoldActionResponse extends ActionSuccessResponse {
    success: boolean
    callId: string
}
export type HoldAction = Action<
    'hold',
    never,
    HoldActionResponse
>

/* Unhold */
interface UnholdActionResponse extends ActionSuccessResponse {
    success: boolean
    callId: string
}
export type UnholdAction = Action<
    'unhold',
    never,
    UnholdActionResponse
>

/* Hangup */
interface HangupActionResponse extends ActionSuccessResponse {
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
interface SendDTMFActionResponse extends ActionSuccessResponse {
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
interface TransferActionResponse extends ActionSuccessResponse {
    callId: string
    success: boolean
}
export type TransferAction = Action<
    'transfer',
    TransferEventData,
    TransferActionResponse
>

/* Unregister */
interface UnregisterActionResponse extends ActionSuccessResponse {
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
