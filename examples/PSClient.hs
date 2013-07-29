{-# LANGUAGE OverloadedStrings, ScopedTypeVariables #-}
module PSClient where

import Control.Monad(void)
import System.Environment (getArgs)
import Data.Time.Clock(getCurrentTime)
import Control.Concurrent.STM

import qualified Data.Text as T
import qualified Data.Text.IO as T
import qualified System.Log.Logger as L

import ADL.Utils.Resource
import ADL.Utils.Format
import ADL.Core.Value
import ADL.Core.Sink
import ADL.Core.Comms
import ADL.Core.Comms.Rpc
import qualified ADL.Core.Comms.HTTP as HTTP

import ADL.Examples.Pubsub
import ADL.Examples.Pubsub1

import Utils

withConnection :: FilePath -> (SinkConnection MyChannelReq -> EndPoint -> IO a) -> IO a
withConnection rfile f = do
  s <- aFromJSONFile' defaultJSONFlags rfile 

  withResource ADL.Core.Comms.newContext $ \ctx -> do
    http <- HTTP.newTransport ctx
    withResource (HTTP.newEndPoint http (Right (2100,2200))) $ \ep ->
      withResource (throwLeft =<< connect ctx s) $ \sc ->
        f sc ep

publish :: MyMessage -> SinkConnection MyChannelReq -> EndPoint -> IO ()
publish value sc ep = throwLeft =<< send sc (ChannelReq_publish value)

subscribe :: Pattern -> SinkConnection MyChannelReq -> EndPoint -> IO ()
subscribe pattern sc ep =
  withResource (newLocalSink ep Nothing processMessage) $ \ls -> do
  throwRPCError =<< callRPC' ChannelReq_subscribe sc ep (seconds 20) (Subscribe pattern (toSink ls))
  threadWait
  where
    processMessage :: MyMessage -> IO ()
    processMessage m = T.putStrLn (template "$1: $2" [T.pack (show (message_timestamp m)),message_payload m])

usage = do
  putStrLn "Usage:"
  putStrLn "    psclient publish <value>"
  putStrLn "    psclient subscribe <pattern>"

run args = do
  let run' = withConnection "/tmp/psServer.ref"
  case args of
    ["publish",value] -> do
      tstamp <- getCurrentTime
      run' (publish (Message tstamp (T.pack value)))
    ["subscribe",pattern] -> run' (subscribe (T.pack pattern))
    _ -> usage

main = getArgs >>= run
    